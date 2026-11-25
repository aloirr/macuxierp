#!/usr/bin/env bash
# T-0056 (E3): roda o e2e do portal /config + BKO (Integração FDV) com as telas reais (next dev) e a API real (banco efêmero).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-portal-integracao.sh [pasta dos prints]   (portas: API 3201, web 3101)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
SAIDA="${1:-$TMP/prints}"
PORTA_API="${PORTA_API:-3201}"
PORTA_WEB="${PORTA_WEB:-3101}"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT

cd "$RAIZ"
subir_api tests/e2e/api-portal-integracao.ts "$PORTA_API"
(cd apps/web && MACUXIERP_API_URL="http://127.0.0.1:$PORTA_API" exec setsid npx next dev -p "$PORTA_WEB" >"$TMP/web.log" 2>&1) &
PID_WEB=$!
esperar_web "http://localhost:$PORTA_WEB/login" || { tail -40 "$TMP/web.log" >&2; exit 1; }

INICIO=$(date +%s)
set +e
node tests/e2e/portal-integracao.mjs --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --saida "$SAIDA"
CODIGO=$?
set -e
echo "[e2e] tempo: $(( $(date +%s) - INICIO )) s" >&2
[ "$CODIGO" -ne 0 ] && tail -40 "$TMP/web.log" >&2
exit "$CODIGO"
