#!/usr/bin/env bash
# T-0133 (v0.3.30, ADR 0021): as telas do login sem empresa (tests/e2e/login-sem-empresa.test.ts, Playwright no vitest) com o
# web real (next dev) e a API real (tests/e2e/api-login-config.ts, banco efêmero, "Esqueci a senha" com e-mail em memória).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem rede.
# Uso: bash tests/e2e/rodar-login-sem-empresa.sh   (portas: API 3205, web 3105)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT
cd "$RAIZ"
PORTA_API="${PORTA_API:-3205}"
PORTA_WEB="${PORTA_WEB:-3105}"
subir_api tests/e2e/api-login-config.ts "$PORTA_API"
(cd "$RAIZ/apps/web" && MACUXIERP_API_URL="http://127.0.0.1:$PORTA_API" exec setsid npx next dev -p "$PORTA_WEB" >"$TMP/web.log" 2>&1) &
PID_WEB=$!
esperar_web "http://localhost:$PORTA_WEB/login" || { tail -40 "$TMP/web.log" >&2; exit 1; }
set +e
MACUXI_E2E_BASE="http://localhost:$PORTA_WEB" MACUXI_E2E_DADOS="$TMP/dados.json" npx vitest run --config tests/vitest.config.ts tests/e2e/login-sem-empresa.test.ts
codigo=$?
set -e
[ "$codigo" -ne 0 ] && tail -40 "$TMP/web.log" >&2
exit "$codigo"
