#!/usr/bin/env bash
# Comandos do operador na VM de produção do Macuxi ERP (T-0024, T-0050). Roda como o usuário do deploy (grupo docker),
# na pasta ~/macuxierp-deploy/ que o producao-publicar copia; usa /opt/macuxierp (ou MACUXIERP_DIR) e o contêiner de
# ferramenta `psql` do compose.yml (imagem da API, admin do DBaaS). Nenhum segredo novo no .env.
#
# Uso:
#   bash ~/macuxierp-deploy/operador.sh criar-empresa --slug <slug> --nome "<nome da empresa>" \
#        --admin-email "<e-mail do administrador>" [--admin-nome "<nome>"] --operador <seu nome> [--confirmar]
#   bash ~/macuxierp-deploy/operador.sh criar-superadmin --email "<e-mail>" [--nome "<nome>"] --operador <seu nome> [--confirmar]
#   bash ~/macuxierp-deploy/operador.sh superadmin --email "<e-mail>" --desativar|--reativar|--destravar \
#        --operador <seu nome> [--confirmar]
#
# Comum aos três:
#   - sem --confirmar: só mostra o plano (transação READ ONLY no banco); nada muda e nenhuma senha é gerada;
#   - com --confirmar: aplica numa transação única e auditada. IDEMPOTENTE: repetir não duplica nada, NÃO troca a senha
#     de quem já existe e não audita de novo o que já estava no estado pedido;
#   - nome da empresa, e-mails e nomes de pessoa vão ao contêiner só pelo ambiente (-e NOME, sem valor no argv) e nunca
#     aparecem no argv, na saída, nos erros nem na auditoria (que guarda slug, ids e números).
#
# criar-empresa: primeiro acesso de uma empresa (tenant, 1º administrador e as licenças core, cadastros, pedido e
#   integracao-fdv; motivo "primeiro acesso"). --nome é o nome legal (de MEI pode ser dado pessoal): 2 a 120 caracteres,
#   com acento e pontuação, entre aspas. --admin-nome é opcional (padrão "Administrador"); o faturamento e o fiscal NÃO
#   são ligados (licenca.mjs). Roda o empresa.mjs.
# criar-superadmin (ADR 0012 §5): o superadmin do portal /config, com deve_trocar_senha (troca no 1º acesso), auditado
#   no tenant de referência (plataforma.superadmin.criar). --nome é opcional (padrão "Superadmin"; 2 a 80 caracteres).
# superadmin (ADR 0012 §5): --desativar (revoga as sessões abertas do portal), --reativar ou --destravar (zera as falhas
#   e a trava da §6); uma ação por vez, auditada (plataforma.superadmin.<ação>). Nunca gera nem troca senha.
#   Os dois rodam o superadmin.mjs.
#
# Senha provisória (criar-empresa e criar-superadmin): 16 caracteres do alfabeto da API, gerada AQUI a partir do
# /dev/urandom, entra no contêiner só pelo ambiente (-e) e aparece UMA vez neste terminal, só se a pessoa foi criada
# agora. Entregue-a por um canal seguro (nunca em recado, chat ou e-mail aberto).
#
# O script do contêiner vai pelo stdin. Saída 0 = ok; 2 = uso; 1 = falha (nada gravado).
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

erro() { echo "[operador] ERRO: $2" >&2; exit "$1"; }
uso() { sed -n '/^# Uso:$/,/^#$/p' "$0" | sed '1d;$d' | sed 's/^# \{0,3\}//' >&2; erro 2 "$1"; }

# Mesmo alfabeto da senha provisória da API (modules/core/domain/usuarios.ts: sem 0/O, 1/l/I).
ALFABETO='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%+=?'
TAMANHO_SENHA=16
PADRAO_EMAIL='^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
PADRAO_OPERADOR='^[a-z][a-z0-9._-]{1,39}$'

# Tamanho em caracteres (não bytes), qualquer que seja o locale da sessão SSH: o empresa.mjs e o superadmin.mjs contam igual.
tamanho() { local LC_ALL=C.UTF-8; printf '%s' "${#1}"; }

gerar_senha() { # amostragem por rejeição (tr -dc descarta o byte fora do alfabeto de 64): sem viés
  local s=''
  while :; do
    s="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc "$ALFABETO")"
    s="${s:0:$TAMANHO_SENHA}"
    [ "${#s}" -eq "$TAMANHO_SENHA" ] || continue
    [[ "$s" =~ [A-Z] && "$s" =~ [a-z] && "$s" =~ [2-9] ]] && break # maiúscula, minúscula e dígito, como a API
  done
  printf '%s' "$s"
}

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
  local SLUG='' NOME='' EMAIL='' ADMIN_NOME='Administrador' OPERADOR='' CONFIRMAR=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --confirmar) CONFIRMAR=1; shift; continue ;;
      --slug | --nome | --admin-email | --admin-nome | --operador) [ $# -ge 2 ] || uso "$1 exige um valor" ;;
      *) uso "opção desconhecida: $1" ;;
    esac
    case "$1" in
      --slug) SLUG="$2" ;;
      --nome) NOME="$2" ;;
      --admin-email) EMAIL="$2" ;;
      --admin-nome) ADMIN_NOME="$2" ;;
      --operador) OPERADOR="$2" ;;
    esac
    shift 2
  done
  [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,39}$ ]] || uso "--slug: minúsculas, dígitos e hífen, 2 a 40 caracteres"
  texto --nome "$NOME" 2 120
  [[ "$EMAIL" =~ $PADRAO_EMAIL ]] || uso "--admin-email fora do formato"
  texto --admin-nome "$ADMIN_NOME" 2 80
  [[ "$OPERADOR" =~ $PADRAO_OPERADOR ]] || uso "--operador exige o nome de quem executa (ex.: alexandre)"
  preparar empresa.mjs

  local ARGS=(--slug "$SLUG" --operador "$OPERADOR") SENHA=''
  if [ "$CONFIRMAR" = 1 ]; then
    SENHA="$(gerar_senha)"
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
      --desativar | --reativar | --destravar)
        [ "$COMANDO" = superadmin ] || uso "$1 só no comando superadmin"
        [ -z "$ACAO" ] || uso "uma ação por vez: --desativar, --reativar ou --destravar"
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
  [ -n "$ACAO" ] || uso "superadmin exige uma ação: --desativar, --reativar ou --destravar"
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
    if [ "$ACAO" = criar ]; then
      SENHA="$(gerar_senha)"
      export MACUXIERP_SENHA_INICIAL="$SENHA"
      ENVS+=(-e MACUXIERP_SENHA_INICIAL)
    fi
  fi
  conteiner superadmin.mjs "${ARGS[@]}"
  if [ "$STATUS" -ne 0 ]; then
    erro 1 "$COMANDO falhou (código $STATUS; veja a linha [superadmin] acima). Nada foi gravado${SENHA:+; a senha gerada foi descartada}"
  fi
  local TIPO=alteracao
  [ "$ACAO" != criar ] || TIPO=criacao
  case "$TIPO:$ESTADO" in
    'criacao:estado: superadmin-criado')
      [ "$CONFIRMAR" = 1 ] || erro 1 "estado inesperado numa simulação"
      printf '\nSenha provisória do superadmin (aparece só agora; entregue por canal seguro; troca no 1º acesso):\n  %s\n' "$SENHA"
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
