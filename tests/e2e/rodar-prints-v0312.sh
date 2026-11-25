#!/usr/bin/env bash
# v0.3.12 (I-9 e C-5, regra 3 da T-0065): prints 1280 e 390 do /config (Integração e Dados), do BKO (Integração FDV) e das telas
# do core, com as telas reais (next dev) e a API real (banco efêmero, massa fictícia de tests/e2e/api-prints-v0312.ts).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-prints-v0312.sh [pasta dos prints, padrão docs/testes/prints]   (portas: API 3202, web 3102)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
export MACUXI_DB_MIGRACOES="${MACUXI_DB_MIGRACOES:-$RAIZ/db/migrations}"
TMP="$(mktemp -d)"
SAIDA="${1:-$RAIZ/docs/testes/prints}"
PORTA_API="${PORTA_API:-3202}"
PORTA_WEB="${PORTA_WEB:-3102}"
VITE_NODE="$(ls -d "$RAIZ"/node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)"
PID_API=""
PID_WEB=""
encerrar() {
  # O next dev abre filhos (next-server): mata o grupo inteiro, senão a porta fica presa.
  [ -n "$PID_WEB" ] && kill -- "-$PID_WEB" 2>/dev/null || true
  [ -n "$PID_API" ] && kill -TERM "$PID_API" 2>/dev/null && wait "$PID_API" 2>/dev/null || true
  rm -rf "$TMP"
}
trap encerrar EXIT

cd "$RAIZ"
node "$VITE_NODE" tests/e2e/api-prints-v0312.ts -- --porta "$PORTA_API" --pronto "$TMP/dados.json" &
PID_API=$!
(cd apps/web && MACUXIERP_API_URL="http://127.0.0.1:$PORTA_API" exec setsid npx next dev -p "$PORTA_WEB" >"$TMP/web.log" 2>&1) &
PID_WEB=$!

for _ in $(seq 1 180); do
  kill -0 "$PID_API" 2>/dev/null || break
  [ -s "$TMP/dados.json" ] && curl -s -o /dev/null "http://localhost:$PORTA_WEB/login" && break
  sleep 1
done
[ -s "$TMP/dados.json" ] || { echo "API não subiu" >&2; exit 1; }

INICIO=$(date +%s)
set +e
node tests/e2e/prints-v0312.mjs --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --saida "$SAIDA"
CODIGO=$?
set -e
echo "[prints] tempo: $(( $(date +%s) - INICIO )) s" >&2
[ "$CODIGO" -ne 0 ] && tail -40 "$TMP/web.log" >&2
exit "$CODIGO"
