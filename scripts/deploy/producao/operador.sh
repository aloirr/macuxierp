#!/usr/bin/env bash
# Comandos do operador na VM de produção do Macuxi ERP (T-0024). Roda como o usuário do deploy (grupo docker), na pasta
# ~/macuxierp-deploy/ que o producao-publicar copia; usa /opt/macuxierp (ou MACUXIERP_DIR) e o contêiner de ferramenta
# `psql` do compose.yml (imagem da API, admin do DBaaS). Nenhum segredo novo no .env.
#
# Primeiro acesso de uma empresa (tenant, 1º administrador e as licenças core, cadastros, pedido e integracao-fdv):
#
#   bash ~/macuxierp-deploy/operador.sh criar-empresa --slug <slug> --nome "<nome da empresa>" \
#        --admin-email "<e-mail do administrador>" [--admin-nome "<nome>"] --operador <seu nome> [--confirmar]
#
#   - sem --confirmar: só mostra o plano (transação READ ONLY no banco); nada muda e nenhuma senha é gerada;
#   - com --confirmar: cria o que falta numa transação única e auditada (motivo "primeiro acesso"). IDEMPOTENTE: repetir
#     não duplica nada e NÃO troca a senha de um administrador que já existe;
#   - a senha provisória (16 caracteres, alfabeto da API) é gerada AQUI, a partir do /dev/urandom, e entra no contêiner
#     só pelo ambiente (-e), nunca no argv. Aparece UMA vez neste terminal, e só se o administrador foi criado agora.
#     Entregue-a ao administrador por um canal seguro (nunca em recado, chat ou e-mail aberto);
#   - --nome é o nome legal da empresa (de MEI pode ser dado pessoal): 2 a 120 caracteres, com acento e pontuação, entre
#     aspas. Vai ao contêiner só pelo ambiente, como o e-mail; nunca aparece no argv, na saída, nos erros nem na auditoria;
#   - --admin-nome é opcional (padrão "Administrador"); o faturamento e o fiscal NÃO são ligados (licenca.mjs).
#
# O que roda no contêiner: empresa.mjs (ao lado), pelo stdin. Saída 0 = ok; 2 = uso; 1 = falha (nada gravado).
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

erro() { echo "[operador] ERRO: $2" >&2; exit "$1"; }
uso() { sed -n '8,9p' "$0" | sed 's/^# \{0,3\}//' >&2; erro 2 "$1"; }

# Mesmo alfabeto da senha provisória da API (modules/core/domain/usuarios.ts: sem 0/O, 1/l/I).
ALFABETO='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%+=?'
TAMANHO_SENHA=16

# Tamanho em caracteres (não bytes), qualquer que seja o locale da sessão SSH: o empresa.mjs conta igual.
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

[ "${1:-}" = criar-empresa ] || uso "comando desconhecido: ${1:-(nenhum)} (só criar-empresa)"
shift
SLUG='' NOME='' EMAIL='' ADMIN_NOME='Administrador' OPERADOR='' CONFIRMAR=0
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
N="$(tamanho "$NOME")"
[ "$N" -ge 2 ] && [ "$N" -le 120 ] || uso "--nome: 2 a 120 caracteres"
[[ "$NOME" != *[[:cntrl:]]* ]] || uso "--nome: sem quebra de linha nem caractere de controle"
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || uso "--admin-email fora do formato"
[ "${#ADMIN_NOME}" -ge 2 ] && [ "${#ADMIN_NOME}" -le 80 ] || uso "--admin-nome: 2 a 80 caracteres"
[[ "$OPERADOR" =~ ^[a-z][a-z0-9._-]{1,39}$ ]] || uso "--operador exige o nome de quem executa (ex.: alexandre)"
[ -s "$ORIGEM/empresa.mjs" ] || erro 2 "$ORIGEM/empresa.mjs ausente (o producao-publicar copia scripts/deploy/producao/*)"

PASTA="${MACUXIERP_DIR:-/opt/macuxierp}"
cd "$PASTA" || erro 2 "pasta $PASTA ausente"
for f in .env gerados.env banco.env admin.env imagens.env; do
  [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (quem grava: env.modelo)"
done

ARGS=(--slug "$SLUG" --operador "$OPERADOR")
SENHA=''
if [ "$CONFIRMAR" = 1 ]; then
  SENHA="$(gerar_senha)"
  ARGS+=(--confirmar)
fi

# Nome da empresa, e-mail, nome da pessoa e senha vão ao contêiner só pelo ambiente (-e NOME, sem valor no argv). O
# contêiner nunca os imprime; a saída dele tem só slug, ids e o estado.
set +e
SAIDA="$(
  export MACUXIERP_EMPRESA_NOME="$NOME" MACUXIERP_ADMIN_EMAIL="$EMAIL" MACUXIERP_ADMIN_NOME="$ADMIN_NOME"
  [ "$CONFIRMAR" = 1 ] && export MACUXIERP_SENHA_INICIAL="$SENHA"
  ENVS=(-e MACUXIERP_EMPRESA_NOME -e MACUXIERP_ADMIN_EMAIL -e MACUXIERP_ADMIN_NOME)
  [ "$CONFIRMAR" = 1 ] && ENVS+=(-e MACUXIERP_SENHA_INICIAL)
  dc --profile ferramentas run --rm --no-deps -T "${ENVS[@]}" psql node --input-type=module - "${ARGS[@]}" < "$ORIGEM/empresa.mjs"
)"
STATUS=$?
set -e
[ -n "$SAIDA" ] && printf '%s\n' "$SAIDA"
if [ "$STATUS" -ne 0 ]; then
  SENHA=''
  erro 1 "criar-empresa falhou (código $STATUS; veja a linha [empresa] acima). Nada foi gravado; a senha gerada foi descartada"
fi

ESTADO="$(printf '%s\n' "$SAIDA" | tail -n 1)"
case "$ESTADO" in
  'estado: usuario-criado')
    [ "$CONFIRMAR" = 1 ] || erro 1 "estado inesperado numa simulação"
    printf '\nSenha provisória do administrador (aparece só agora; entregue por canal seguro):\n  %s\n' "$SENHA"
    ;;
  'estado: usuario-existia') echo "[operador] o administrador já existia: a senha dele NÃO foi alterada (nenhuma senha nova)." ;;
  'estado: simulacao') echo "[operador] SIMULAÇÃO: nada gravado. Repita com --confirmar para aplicar." ;;
  *) SENHA=''; erro 1 "resposta do contêiner sem a linha de estado; confira com o licenca.mjs listar antes de repetir" ;;
esac
SENHA=''
