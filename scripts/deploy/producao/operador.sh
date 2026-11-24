#!/usr/bin/env bash
# Comandos do operador na VM de produção do Macuxi ERP (T-0024, T-0050). Roda como o usuário do deploy (grupo docker),
# na pasta ~/macuxierp-deploy/ que o producao-publicar copia; usa /opt/macuxierp (ou MACUXIERP_DIR) e o contêiner de
# ferramenta `psql` do compose.yml (imagem da API, admin do DBaaS). Nenhum segredo novo no .env.
#
# Uso:
#   bash ~/macuxierp-deploy/operador.sh criar-empresa --codigo <código do FDV> | --uf <UF> --nome "<nome da empresa>" \
#        --admin-email "<e-mail do administrador>" [--admin-nome "<nome>"] --operador <seu nome> [--confirmar]
#   bash ~/macuxierp-deploy/operador.sh criar-superadmin --email "<e-mail>" [--nome "<nome>"] --operador <seu nome> [--confirmar]
#   bash ~/macuxierp-deploy/operador.sh superadmin --email "<e-mail>" --desativar|--reativar|--destravar|--redefinir-senha \
#        --operador <seu nome> [--confirmar]
#
# Comum aos três:
#   - sem --confirmar: só mostra o plano (transação READ ONLY no banco); nada muda e nenhuma senha é gerada;
#   - com --confirmar: aplica numa transação única e auditada. IDEMPOTENTE: repetir não duplica nada, NÃO troca a senha
#     de quem já existe e não audita de novo o que já estava no estado pedido (a exceção é o --redefinir-senha, que
#     existe para trocar a senha: cada execução confirmada grava uma senha nova e audita de novo);
#   - nome da empresa, e-mails e nomes de pessoa vão ao contêiner só pelo ambiente (-e NOME, sem valor no argv) e nunca
#     aparecem no argv, na saída, nos erros nem na auditoria (que guarda código, ids e números).
#
# criar-empresa: primeiro acesso de uma empresa (tenant, 1º administrador e as licenças core, cadastros, pedido e
#   integracao-fdv; motivo "primeiro acesso"). --nome é o nome legal (de MEI pode ser dado pessoal): 2 a 120 caracteres,
#   com acento e pontuação, entre aspas. --admin-nome é opcional (padrão "Administrador"); o faturamento e o fiscal NÃO
#   são ligados (licenca.mjs). Roda o empresa.mjs.
#   --codigo é o código da licença do Macuxi FDV, UF + 4 dígitos (ex.: AM2808; RN-CORE-11), sem diferenciar maiúsculas;
#   empresa sem FDV: --uf <UF> sorteia UF + 4 dígitos livres. Um dos dois. A saída mostra o código final.
#   --slug (legado) saiu na fase 2 da T-0053: agora dá erro de uso (saída 2).
# criar-superadmin (ADR 0012 §5): o superadmin do portal /config, com deve_trocar_senha (troca no 1º acesso), auditado
#   no tenant de referência (plataforma.superadmin.criar). --nome é opcional (padrão "Superadmin"; 2 a 80 caracteres).
# superadmin (ADR 0012 §5): --desativar (revoga as sessões abertas do portal), --reativar, --destravar (zera as falhas
#   e a trava da §6) ou --redefinir-senha (T-0077: senha provisória nova com troca no 1º acesso, zera falhas e trava e
#   revoga as sessões abertas; superadmin desativado é recusado, reative antes); uma ação por vez, auditada
#   (plataforma.superadmin.<ação>). Os dois rodam o superadmin.mjs.
#
# Senha provisória (criar-empresa, criar-superadmin e superadmin --redefinir-senha): 16 caracteres do alfabeto da API,
# com letra, número e caractere especial por construção (regra única de senha, T-0052), gerada AQUI a partir do
# /dev/urandom só com --confirmar, entra no contêiner só pelo ambiente (-e) e aparece UMA vez neste terminal, só se a
# pessoa foi criada ou a senha redefinida agora; em falha, é descartada sem aparecer. Entregue-a por um canal seguro
# (nunca em recado, chat ou e-mail aberto).
#
# O script do contêiner vai pelo stdin. Saída 0 = ok; 2 = uso; 1 = falha (nada gravado).
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

erro() { echo "[operador] ERRO: $2" >&2; exit "$1"; }
uso() { sed -n '/^# Uso:$/,/^#$/p' "$0" | sed '1d;$d' | sed 's/^# \{0,3\}//' >&2; erro 2 "$1"; }

PADRAO_EMAIL='^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
PADRAO_OPERADOR='^[a-z][a-z0-9._-]{1,39}$'

# Tamanho em caracteres (não bytes), qualquer que seja o locale da sessão SSH: o empresa.mjs e o superadmin.mjs contam igual.
tamanho() { local LC_ALL=C.UTF-8; printf '%s' "${#1}"; }

# >>> gerador da senha provisória (o teste apps/api/src/operador-senha.test.ts roda este trecho e trava as classes)
# Mesmas classes da senha provisória da API (modules/core/domain/usuarios.ts: sem 0/O, 1/l/I).
MAIUSCULAS='ABCDEFGHJKLMNPQRSTUVWXYZ'
MINUSCULAS='abcdefghijkmnopqrstuvwxyz'
DIGITOS='23456789'
SIMBOLOS='!@#%+=?'
ALFABETO="$MAIUSCULAS$MINUSCULAS$DIGITOS$SIMBOLOS"
TAMANHO_SENHA=16

# Inteiros de 32 bits do /dev/urandom lidos de uma vez por senha (64; a senha usa 35, o resto cobre a rejeição).
SORTEIO=()
POSICAO=0
R=0
sortear() { # R = inteiro uniforme em [0, $1): rejeição acima do maior múltiplo de $1 (chance < 2^-26 por inteiro)
  local limite=$((4294967296 - 4294967296 % $1))
  while [ "$POSICAO" -lt "${#SORTEIO[@]}" ]; do # limitado aos 64 inteiros lidos: sem laço aberto
    R="${SORTEIO[POSICAO]}"
    POSICAO=$((POSICAO + 1))
    if [ "$R" -lt "$limite" ]; then
      R=$((R % $1))
      return 0
    fi
  done
  return 1
}

# Por construção, sem sorteio repetido: um caractere de cada classe (maiúscula, minúscula, dígito, especial), o resto do
# alfabeto inteiro e embaralhamento de Fisher-Yates. Cumpre a regra única do SDK (letra, número e especial; 16 >= 8).
gerar_senha() {
  local -a c=()
  local classe i t
  read -r -a SORTEIO <<<"$(od -An -v -N256 -tu4 /dev/urandom | tr '\n' ' ')"
  POSICAO=0
  [ "${#SORTEIO[@]}" -eq 64 ] || return 1
  for classe in "$MAIUSCULAS" "$MINUSCULAS" "$DIGITOS" "$SIMBOLOS"; do
    sortear "${#classe}" || return 1
    c+=("${classe:R:1}")
  done
  for ((t = ${#c[@]}; t < TAMANHO_SENHA; t++)); do
    sortear "${#ALFABETO}" || return 1
    c+=("${ALFABETO:R:1}")
  done
  for ((i = TAMANHO_SENHA - 1; i > 0; i--)); do
    sortear "$((i + 1))" || return 1
    t="${c[i]}"
    c[i]="${c[R]}"
    c[R]="$t"
  done
  printf '%s' "${c[@]}"
}
# <<< gerador da senha provisória

# texto <opção> <valor> <mín> <máx>: tamanho em caracteres e sem caractere de controle (sem ecoar o valor)
texto() {
  local n
  n="$(tamanho "$2")"
  [ "$n" -ge "$3" ] && [ "$n" -le "$4" ] || uso "$1: $3 a $4 caracteres"
  [[ "$2" != *[[:cntrl:]]* ]] || uso "$1: sem quebra de linha nem caractere de controle"
}

# Pasta da VM e os arquivos de interpolação do compose; o script do contêiner tem de estar ao lado.
preparar() {
  [ -s "$ORIGEM/$1" ] || erro 2 "$ORIGEM/$1 ausente (o producao-publicar copia scripts/deploy/producao/*)"
  PASTA="${MACUXIERP_DIR:-/opt/macuxierp}"
  cd "$PASTA" || erro 2 "pasta $PASTA ausente"
  for f in .env gerados.env banco.env admin.env imagens.env; do
    [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (quem grava: env.modelo)"
  done
}

# contêiner <script.mjs> <args...>: roda o script no `psql` com as variáveis de ENVS (já exportadas no subshell de quem
# chama) repassadas só pelo nome (-e NOME). Deixa a saída em SAIDA e o código em STATUS e a imprime.
conteiner() {
  local script="$1"
  shift
  set +e
  SAIDA="$(dc --profile ferramentas run --rm --no-deps -T "${ENVS[@]}" psql node --input-type=module - "$@" < "$ORIGEM/$script")"
  STATUS=$?
  set -e
  if [ -n "$SAIDA" ]; then printf '%s\n' "$SAIDA"; fi
  ESTADO="$(printf '%s\n' "$SAIDA" | tail -n 1)"
}

criar_empresa() {
  local CODIGO='' UF='' NOME='' EMAIL='' ADMIN_NOME='Administrador' OPERADOR='' CONFIRMAR=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --confirmar) CONFIRMAR=1; shift; continue ;;
      --slug) uso "--slug saiu: use --codigo <código do FDV, ex.: AM2808> ou --uf <UF> para sortear" ;;
      --codigo | --uf | --nome | --admin-email | --admin-nome | --operador) [ $# -ge 2 ] || uso "$1 exige um valor" ;;
      *) uso "opção desconhecida: $1" ;;
    esac
    case "$1" in
      --codigo) CODIGO="$2" ;;
      --uf) UF="$2" ;;
      --nome) NOME="$2" ;;
      --admin-email) EMAIL="$2" ;;
      --admin-nome) ADMIN_NOME="$2" ;;
      --operador) OPERADOR="$2" ;;
    esac
    shift 2
  done
  # formato aqui; a UF da lista oficial (UFS do SDK) o empresa.mjs confere
  local EMPRESA_ARGS=()
  if [ -n "$CODIGO" ] && [ -z "$UF" ]; then
    [[ "$CODIGO" =~ ^[A-Za-z]{2}[0-9]{4}$ ]] || uso "--codigo: código do FDV, UF + 4 dígitos, ex.: AM2808"
    EMPRESA_ARGS=(--codigo "$CODIGO")
  elif [ -n "$UF" ] && [ -z "$CODIGO" ]; then
    [[ "$UF" =~ ^[A-Za-z]{2}$ ]] || uso "--uf: sigla da UF, ex.: AM"
    EMPRESA_ARGS=(--uf "$UF")
  else
    uso "informe --codigo <código do FDV, ex.: AM2808> ou --uf <UF> para sortear (um dos dois)"
  fi
  texto --nome "$NOME" 2 120
  [[ "$EMAIL" =~ $PADRAO_EMAIL ]] || uso "--admin-email fora do formato"
  texto --admin-nome "$ADMIN_NOME" 2 80
  [[ "$OPERADOR" =~ $PADRAO_OPERADOR ]] || uso "--operador exige o nome de quem executa (ex.: alexandre)"
  preparar empresa.mjs

  local ARGS=("${EMPRESA_ARGS[@]}" --operador "$OPERADOR") SENHA=''
  if [ "$CONFIRMAR" = 1 ]; then
    SENHA="$(gerar_senha)" || erro 1 "não foi possível gerar a senha provisória (nada foi gravado)"
    ARGS+=(--confirmar)
  fi
  export MACUXIERP_EMPRESA_NOME="$NOME" MACUXIERP_ADMIN_EMAIL="$EMAIL" MACUXIERP_ADMIN_NOME="$ADMIN_NOME"
  ENVS=(-e MACUXIERP_EMPRESA_NOME -e MACUXIERP_ADMIN_EMAIL -e MACUXIERP_ADMIN_NOME)
  if [ "$CONFIRMAR" = 1 ]; then
    export MACUXIERP_SENHA_INICIAL="$SENHA"
    ENVS+=(-e MACUXIERP_SENHA_INICIAL)
  fi
  conteiner empresa.mjs "${ARGS[@]}"
  if [ "$STATUS" -ne 0 ]; then
    erro 1 "criar-empresa falhou (código $STATUS; veja a linha [empresa] acima). Nada foi gravado; a senha gerada foi descartada"
  fi
  case "$ESTADO" in
    'estado: usuario-criado')
      [ "$CONFIRMAR" = 1 ] || erro 1 "estado inesperado numa simulação"
      printf '\nSenha provisória do administrador (aparece só agora; entregue por canal seguro):\n  %s\n' "$SENHA"
      ;;
    'estado: usuario-existia') echo "[operador] o administrador já existia: a senha dele NÃO foi alterada (nenhuma senha nova)." ;;
    'estado: simulacao') echo "[operador] SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar." ;;
    *) erro 1 "resposta do contêiner sem a linha de estado; confira com o licenca.mjs listar antes de repetir" ;;
  esac
}

# superadmin <criar-superadmin|superadmin> <opções>
superadmin() {
  local COMANDO="$1" EMAIL='' NOME='' ACAO='' OPERADOR='' CONFIRMAR=0
  shift
  if [ "$COMANDO" = criar-superadmin ]; then ACAO=criar NOME='Superadmin'; fi
  while [ $# -gt 0 ]; do
    case "$1" in
      --confirmar) CONFIRMAR=1; shift; continue ;;
      --desativar | --reativar | --destravar | --redefinir-senha)
        [ "$COMANDO" = superadmin ] || uso "$1 só no comando superadmin"
        [ -z "$ACAO" ] || uso "uma ação por vez: --desativar, --reativar, --destravar ou --redefinir-senha"
        ACAO="${1#--}"; shift; continue ;;
      --nome) [ "$COMANDO" = criar-superadmin ] || uso "--nome só no criar-superadmin"; [ $# -ge 2 ] || uso "$1 exige um valor" ;;
      --email | --operador) [ $# -ge 2 ] || uso "$1 exige um valor" ;;
      *) uso "opção desconhecida: $1" ;;
    esac
    case "$1" in
      --email) EMAIL="$2" ;;
      --nome) NOME="$2" ;;
      --operador) OPERADOR="$2" ;;
    esac
    shift 2
  done
  [ -n "$ACAO" ] || uso "superadmin exige uma ação: --desativar, --reativar, --destravar ou --redefinir-senha"
  [[ "$EMAIL" =~ $PADRAO_EMAIL ]] && [ "${#EMAIL}" -le 254 ] || uso "--email fora do formato"
  [ "$ACAO" != criar ] || texto --nome "$NOME" 2 80
  [[ "$OPERADOR" =~ $PADRAO_OPERADOR ]] || uso "--operador exige o nome de quem executa (ex.: alexandre)"
  preparar superadmin.mjs

  local ARGS=(--acao "$ACAO" --operador "$OPERADOR") SENHA=''
  export MACUXIERP_SUPERADMIN_EMAIL="$EMAIL"
  ENVS=(-e MACUXIERP_SUPERADMIN_EMAIL)
  if [ "$ACAO" = criar ]; then
    export MACUXIERP_SUPERADMIN_NOME="$NOME"
    ENVS+=(-e MACUXIERP_SUPERADMIN_NOME)
  fi
  if [ "$CONFIRMAR" = 1 ]; then
    ARGS+=(--confirmar)
    if [ "$ACAO" = criar ] || [ "$ACAO" = redefinir-senha ]; then
      SENHA="$(gerar_senha)" || erro 1 "não foi possível gerar a senha provisória (nada foi gravado)"
      export MACUXIERP_SENHA_INICIAL="$SENHA"
      ENVS+=(-e MACUXIERP_SENHA_INICIAL)
    fi
  fi
  conteiner superadmin.mjs "${ARGS[@]}"
  if [ "$STATUS" -ne 0 ]; then
    erro 1 "$COMANDO falhou (código $STATUS; veja a linha [superadmin] acima). Nada foi gravado${SENHA:+; a senha gerada foi descartada}"
  fi
  local TIPO=alteracao
  case "$ACAO" in
    criar) TIPO=criacao ;;
    redefinir-senha) TIPO=redefinicao ;;
  esac
  case "$TIPO:$ESTADO" in
    'criacao:estado: superadmin-criado')
      [ "$CONFIRMAR" = 1 ] || erro 1 "estado inesperado numa simulação"
      printf '\nSenha provisória do superadmin (aparece só agora; entregue por canal seguro; troca no 1º acesso):\n  %s\n' "$SENHA"
      ;;
    'redefinicao:estado: alterado')
      [ "$CONFIRMAR" = 1 ] || erro 1 "estado inesperado numa simulação"
      printf '\nNova senha provisória do superadmin (aparece só agora; entregue por canal seguro; troca no 1º acesso):\n  %s\n' "$SENHA"
      ;;
    'redefinicao:estado: simulacao')
      [ "$CONFIRMAR" = 0 ] || erro 1 "estado de simulação com --confirmar; a senha gerada foi descartada. Rode sem --confirmar para conferir antes de repetir"
      echo "[operador] SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar."
      ;;
    'criacao:estado: superadmin-existia') echo "[operador] o superadmin já existia: a senha dele NÃO foi alterada (nenhuma senha nova)." ;;
    *':estado: simulacao') echo "[operador] SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar." ;;
    'alteracao:estado: alterado') echo "[operador] superadmin --$ACAO aplicado e auditado." ;;
    'alteracao:estado: sem-mudanca') echo "[operador] nada a fazer: o superadmin já estava no estado pedido (nada auditado)." ;;
    *) erro 1 "resposta do contêiner sem a linha de estado esperada; rode sem --confirmar para conferir antes de repetir" ;;
  esac
}

ENVS=() SAIDA='' STATUS=0 ESTADO='' PASTA=''
case "${1:-}" in
  criar-empresa) shift; ( criar_empresa "$@" ) ;;
  criar-superadmin | superadmin) ( superadmin "$@" ) ;;
  *) uso "comando desconhecido: ${1:-(nenhum)} (criar-empresa, criar-superadmin ou superadmin)" ;;
esac
