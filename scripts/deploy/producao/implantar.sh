#!/usr/bin/env bash
# Publicação da PRODUÇÃO do Macuxi ERP na VM do FDV (T-0024, ADR 0003). Roda NA VM, como o usuário de deploy (grupo docker),
# a partir da pasta para onde o workflow "producao — publicar" copiou scripts/deploy/producao/* (com o comum.sh) e o
# compose.yml da raiz:
#
#   bash implantar.sh --api <imagem@sha256:...> --bko <imagem@sha256:...> --versao <vX.Y.Z>
#
#   --api     imagem da API/worker/migrações POR DIGEST (ghcr.io/aloirr/macuxierp-api, a que passou no CI do commit)
#   --bko     imagem do BKO de produção por digest (ghcr.io/aloirr/macuxierp-web-prod)
#   --versao  tag v* publicada: vai para MACUXIERP_VERSAO e o /v1/saude a devolve (prova de que a versão nova está no ar)
#
# Ordem: TRAVA DA VM (a mesma do FDV, /var/lock/macuxi-producao-vm.lock; ADR 0003, item 2) → conferência dos arquivos de
# /opt/macuxierp → versão em uso guardada (imagens.env + compose.yml → *.anterior) → compose novo e imagens.env → pull →
# banco.sh (banco, migrações, senhas e conferência dos papéis) → troca sem parada da api e do web (troca.sh: a réplica nova
# ao lado da velha, saúde, a velha sai do túnel e drena; ADR 0003, adendo 48 A) → worker → conferência de dentro dos
# contêineres (/v1/saude com banco ok e a versão nova; a raiz "/" do web) → limpeza das imagens SÓ do ERP.
# Saída 0 = publicado. Falha ANTES do up (trava, arquivos, pull, banco): nada da aplicação mudou; saída 1 (2 = argumento).
# Falha DEPOIS do up: VOLTA ATRÁS para a versão anterior (imagens e compose; pelo mesmo caminho sem parada), confere de
# novo e sai com 3. Se a réplica nova não fica saudável, ela sai e a velha nem deixou o túnel. Migração aplicada
# não é desfeita (aditivas: a versão anterior roda sobre o esquema novo). Sem versão anterior (1º deploy): saída 1.
# Só mexe no projeto Compose macuxierp: nunca "docker compose down", nunca contêiner, rede ou imagem do FDV.
# Nenhum segredo é impresso: os .env só são lidos pelo compose; a chave do A1 é conferida sem eco. Sem set -x.
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

API=""; BKO=""; VERSAO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="${2:-}"; shift 2 ;;
    --bko) BKO="${2:-}"; shift 2 ;;
    --versao) VERSAO="${2:-}"; shift 2 ;;
    *) echo "[implantar] opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
# só por digest (a imagem que passou no CI); tag não é aceita
REF='^[a-z0-9][a-z0-9./_-]*(:[0-9]+)?/[a-z0-9./_-]+@sha256:[a-f0-9]{64}$'
[[ "$API" =~ $REF ]] || { echo "[implantar] --api inválida (esperado registro/imagem@sha256:<digest>)" >&2; exit 2; }
[[ "$BKO" =~ $REF ]] || { echo "[implantar] --bko inválida (esperado registro/imagem@sha256:<digest>)" >&2; exit 2; }
[[ "$VERSAO" =~ ^v[0-9A-Za-z._-]{1,64}$ ]] || { echo "[implantar] --versao inválida (esperado v*)" >&2; exit 2; }

log() { echo "[implantar] $(date -u +%H:%M:%S) $*"; }

# ---------- trava da VM, compartilhada com o FDV (antes de qualquer docker compose) ----------
TRAVA=/var/lock/macuxi-producao-vm.lock
# 20 min: cabe no timeout-minutes: 40 do job deploy com o resto da publicação
ESPERA_MAX="${MACUXI_TRAVA_ESPERA_S:-1200}"
[[ "$ESPERA_MAX" =~ ^[0-9]{1,5}$ ]] || { echo "[implantar] MACUXI_TRAVA_ESPERA_S inválido" >&2; exit 2; }
exec 9>"$TRAVA" || { echo "[implantar] sem acesso à trava $TRAVA (o preparar-vm.sh a cria, grupo docker, 660)" >&2; exit 1; }
inicio_trava="$(date +%s)"
log "pegando a trava da VM ($TRAVA; espera até ${ESPERA_MAX} s)"
if ! flock -w "$ESPERA_MAX" 9; then
  echo "[implantar] a trava da VM ficou ocupada por mais de ${ESPERA_MAX} s (deploy do FDV ou do ERP em andamento): nada foi publicado" >&2
  exit 1
fi
log "trava da VM obtida depois de $(( $(date +%s) - inicio_trava )) s de espera"

PASTA=/opt/macuxierp
# compose.yml ao lado (cópia do workflow) ou na raiz do repositório (rodando de um checkout completo)
if [ -f "$ORIGEM/compose.yml" ]; then
  COMPOSE_NOVO="$ORIGEM/compose.yml"
elif [ -f "$ORIGEM/../../../compose.yml" ]; then
  COMPOSE_NOVO="$(cd "$ORIGEM/../../.." && pwd)/compose.yml"
else
  echo "[implantar] compose.yml não encontrado em $ORIGEM nem na raiz do repositório (o workflow copia junto)" >&2
  exit 1
fi

# ---------- arquivos de /opt/macuxierp ----------
[ -d "$PASTA" ] || { echo "[implantar] $PASTA ausente: rode o preparar-vm.sh" >&2; exit 1; }
cd "$PASTA"
[ -f .env ] || { echo "[implantar] $PASTA/.env ausente: o preparar-vm.sh cria (ambiente-vm.sh)" >&2; exit 1; }
modo="$(stat -c %a .env)"
[ "$modo" = 600 ] || { echo "[implantar] $PASTA/.env com modo $modo: precisa ser 600 (chmod 600 $PASTA/.env)" >&2; exit 1; }
# Chaves mestras: 32 bytes, em hex (64) ou base64 (44 com o "="). O valor nunca é impresso.
chave_32_ok() { # nome
  local v
  v="$(valor_env .env "$1")"
  [[ "$v" =~ ^[0-9a-fA-F]{64}$ ]] && return 0
  [[ "$v" =~ ^[A-Za-z0-9+/]{43}=$ ]] && [ "$(printf '%s' "$v" | base64 -d 2>/dev/null | wc -c)" = 32 ] && return 0
  return 1
}
chave_32_ok MACUXIERP_CHAVE_A1 || { echo "[implantar] $PASTA/.env sem MACUXIERP_CHAVE_A1 válida (32 bytes em hex ou base64; o preparar-vm.sh gera só se faltar)" >&2; exit 1; }
chave_32_ok MACUXIERP_CHAVE_INTEGRACAO || { echo "[implantar] $PASTA/.env sem MACUXIERP_CHAVE_INTEGRACAO válida (32 bytes em hex ou base64; o preparar-vm.sh gera só se faltar ou estiver vazia; obrigatória desde a v0.2.0; sem ela, o worker não sobe; ver T-0002)" >&2; exit 1; }
for v in MACUXIERP_HUB_URL_PRODUCAO MACUXIERP_HUB_URL_TESTE; do
  [ -z "$(valor_env .env "$v")" ] || echo "::warning::$PASTA/.env com $v: ignorada (a URL do Hub é fixa no compose.yml); apague a linha"
done
for f in gerados.env banco.env admin.env; do
  [ -s "$f" ] || { echo "[implantar] $PASTA/$f ausente: o preparar-vm.sh grava antes (gerados.env; banco.env e admin.env copiados do /opt/macuxi do FDV)" >&2; exit 1; }
done
REDE_TUNEL="$(rede_tunel)"
docker network inspect "$REDE_TUNEL" >/dev/null 2>&1 \
  || { echo "[implantar] rede do túnel do FDV '$REDE_TUNEL' não existe (o FDV está no ar? MACUXIERP_REDE_TUNEL no .env)" >&2; exit 1; }

# ---------- versão em uso (para voltar atrás) ----------
TEM_ANTERIOR=0
if [ -f imagens.env ] && [ -f compose.yml ]; then
  cp -p imagens.env imagens.anterior.env
  cp -p compose.yml compose.anterior.yml
  TEM_ANTERIOR=1
  log "versão em uso guardada: $(valor_env imagens.anterior.env MACUXIERP_VERSAO)"
fi
restaurar_arquivos() {
  if [ "$TEM_ANTERIOR" = 1 ]; then
    cp -p imagens.anterior.env imagens.env
    cp -p compose.anterior.yml compose.yml
  fi
}

# ---------- TLS do banco ----------
# verify-full só com a CA do DBaaS (/opt/macuxi/certs/dbaas-ca.pem do FDV → certs/, pelo preparar-vm.sh); sem ela, cifra sem conferir o
# certificado. MACUXI_PG_SSL_FORCAR=require|verify-full troca (só manutenção).
if [ -n "${MACUXI_PG_SSL_FORCAR:-}" ]; then
  LIBPQ="$MACUXI_PG_SSL_FORCAR"
elif [ -s certs/dbaas-ca.pem ]; then
  LIBPQ=verify-full
else
  LIBPQ=require
fi
case "$LIBPQ" in
  verify-full) NODE_SSL=verify-full ;;
  require) NODE_SSL=no-verify; echo "::warning::TLS com o DBaaS sem conferir o certificado (falta /opt/macuxi/certs/dbaas-ca.pem do FDV): a conexão é cifrada, mas não autenticada" ;;
  *) echo "[implantar] MACUXI_PG_SSL_FORCAR inválido: $LIBPQ (require|verify-full)" >&2; exit 2 ;;
esac

# ---------- compose e imagens novos ----------
umask 077
install -m 644 "$COMPOSE_NOVO" "$PASTA/compose.yml"
{
  printf 'MACUXIERP_IMAGEM_API=%s\n' "$API"
  printf 'MACUXIERP_IMAGEM_WEB=%s\n' "$BKO"
  printf 'MACUXIERP_VERSAO=%s\n' "$VERSAO"
  printf 'MACUXIERP_PG_SSL_NODE=%s\nMACUXIERP_PG_SSL_LIBPQ=%s\n' "$NODE_SSL" "$LIBPQ"
} > imagens.env
log "publicando $VERSAO (api ${API##*@}, web ${BKO##*@}; TLS $LIBPQ)"

antes_do_up() { # $1 = mensagem
  echo "[implantar] $1: nada da aplicação foi trocado" >&2
  restaurar_arquivos
  exit 1
}

dc config -q || antes_do_up "compose.yml inválido com os arquivos de /opt/macuxierp"

log "baixando imagens"
# novas tentativas no 403/429/5xx do GHCR (o workflow copia o ghcr-tentar.sh ao lado; sem ele, uma tentativa só)
if [ -f "$ORIGEM/ghcr-tentar.sh" ]; then
  # shellcheck source-path=SCRIPTDIR source=ghcr-tentar.sh
  source "$ORIGEM/ghcr-tentar.sh"
else
  ghcr_tentar() { shift; "$@"; }
fi
ghcr_tentar "pull das imagens na VM" dc --profile ferramentas pull --quiet || antes_do_up "pull falhou"

log "banco: criação, migrações, senhas e conferência dos papéis"
MACUXIERP_DIR="$PASTA" bash "$ORIGEM/banco.sh" || antes_do_up "banco.sh falhou"

# ---------- troca sem parada (ADR 0003, adendo 48 A) e conferência ----------
# shellcheck source-path=SCRIPTDIR source=troca.sh
source "$ORIGEM/troca.sh"
VERSAO_ALVO=""
api_da_versao_alvo() { api_na_versao "$1" "$VERSAO_ALVO"; }

conferir() { # 0 = cada api com banco ok e a versão esperada, e cada web respondendo a raiz "/" (de dentro do contêiner)
  local i
  for i in $(seq 1 45); do
    todas_ok macuxierp-api api_na_versao "$1" && { log "api: /v1/saude ok (banco ok, versão $1)"; break; }
    [ "$i" = 45 ] && { echo "[implantar] /v1/saude sem banco ok ou sem a versão $1 em 90 s" >&2; return 1; }
    sleep 2
  done
  for i in $(seq 1 30); do
    todas_ok macuxierp-web web_responde && { log "web: / ok"; return 0; }
    sleep 2
  done
  echo "[implantar] BKO / (raiz, login) não respondeu" >&2
  return 1
}

subir() { # versão → 0 = no ar. Com versão anterior e memória, troca sem parada; senão, recria (janela de 502).
  VERSAO_ALVO="$1"
  if [ "$TEM_ANTERIOR" = 1 ] && memoria_para_troca; then
    trocar_servico macuxierp-api api_da_versao_alvo || return 1
    trocar_servico macuxierp-web || return 1
  elif [ "$TEM_ANTERIOR" = 1 ]; then
    echo "::warning::memória livre da VM abaixo de ${TROCA_MIN_MIB} MiB: publicação recriando os contêineres (janela de 502 de ~30 s)"
  fi
  # o resto (worker; e tudo, no 1º deploy ou sem memória para a troca) como antes; api e web já trocados não são recriados
  dc up -d --remove-orphans --wait --wait-timeout 240
}

log "subindo os serviços"
if subir "$VERSAO" && conferir "$VERSAO"; then
  :
else
  echo "[implantar] a versão $VERSAO não passou na conferência" >&2
  dc logs --no-color --tail 60 macuxierp-api macuxierp-worker macuxierp-web >&2 || true
  if [ "$TEM_ANTERIOR" != 1 ]; then
    echo "[implantar] primeiro deploy: não há versão anterior para voltar (serviços ficam como estão para diagnóstico)" >&2
    exit 1
  fi
  restaurar_arquivos
  versao_ant="$(valor_env imagens.env MACUXIERP_VERSAO)"
  echo "::error::voltando atrás para $versao_ant"
  subir "$versao_ant" || true
  if conferir "$versao_ant"; then
    echo "::error::produção do ERP de volta em $versao_ant (a $VERSAO falhou na conferência)"
  else
    echo "::error::a volta para $versao_ant também falhou na conferência: veja dc ps e dc logs em $PASTA"
  fi
  exit 3
fi

log "alerta: $(systemctl is-active macuxierp-alerta.timer 2>/dev/null || echo '?') ($("$PASTA/alerta-saude.sh" --mostrar 2>/dev/null | head -n 1 || echo 'estado ?'))"

# Limpeza SÓ das imagens do ERP (rótulo de origem do repositório, posto pelo build e pelo Dockerfile) que nenhum contêiner
# usa. Nunca "docker image prune" sem filtro: ele apagaria imagens do FDV sem tag (as puxadas por digest, que o FDV guarda
# para a volta atrás dele). A versão anterior do ERP sai daqui; voltar a ela depois = novo pull pelo digest.
docker image prune -a -f --filter "label=org.opencontainers.image.source=https://github.com/aloirr/macuxierp" >/dev/null \
  || echo "::warning::limpeza das imagens antigas do ERP falhou (sem efeito na publicação)"
dc ps --format 'table {{.Service}}\t{{.Status}}'
log "publicado: $VERSAO"
