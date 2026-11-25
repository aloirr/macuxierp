#!/usr/bin/env bash
# Prints 1280 e 390 de uma versão (RD-2194: um só script para todas): sobe a massa fictícia `tests/e2e/api-prints-<versão>.ts`
# (API real, banco efêmero) e o next dev, e roda o roteiro `tests/e2e/prints-<versão>.mjs`.
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-prints.sh <versão, ex.: v0315> [pasta dos prints, padrão docs/testes/prints/<versão>]
#      (portas: PORTA_API, padrão 3203; PORTA_WEB, padrão 3103)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
V="${1:?uso: bash tests/e2e/rodar-prints.sh <versão, ex.: v0315> [pasta]}"
[ -f "$RAIZ/tests/e2e/api-prints-$V.ts" ] && [ -f "$RAIZ/tests/e2e/prints-$V.mjs" ] || { echo "sem tests/e2e/api-prints-$V.ts ou prints-$V.mjs" >&2; exit 2; }
export MACUXI_DB_MIGRACOES="${MACUXI_DB_MIGRACOES:-$RAIZ/db/migrations}"
TMP="$(mktemp -d)"
SAIDA="${2:-$RAIZ/docs/testes/prints/$V}"
PORTA_API="${PORTA_API:-3203}"
PORTA_WEB="${PORTA_WEB:-3103}"
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
node "$VITE_NODE" "tests/e2e/api-prints-$V.ts" -- --porta "$PORTA_API" --pronto "$TMP/dados.json" &
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
node "tests/e2e/prints-$V.mjs" --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --saida "$SAIDA"
CODIGO=$?
set -e
echo "[prints] tempo: $(( $(date +%s) - INICIO )) s" >&2
[ "$CODIGO" -ne 0 ] && tail -40 "$TMP/web.log" >&2
exit "$CODIGO"
