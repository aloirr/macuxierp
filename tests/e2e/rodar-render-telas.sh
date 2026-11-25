#!/usr/bin/env bash
# X-6 da v0.3.12 (T-0089): abre todas as telas do web em modo de produção (next build + servidor standalone) contra a API real (banco
# efêmero) e falha em qualquer erro de render (tests/e2e/render-telas.mjs). Pré-requisito: Postgres local de pé
# (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-render-telas.sh [pasta de saída]   (portas: API 3202, web 3102; RENDER_SEM_BUILD=1 reaproveita o .next)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
export MACUXI_DB_MIGRACOES="${MACUXI_DB_MIGRACOES:-$RAIZ/db/migrations}"
TMP="$(mktemp -d)"
SAIDA="${1:-$TMP}"
mkdir -p "$SAIDA"
PORTA_API="${PORTA_API:-3202}"
PORTA_WEB="${PORTA_WEB:-3102}"
VITE_NODE="$(ls -d "$RAIZ"/node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)"
PID_API=""
PID_WEB=""
encerrar() {
  # O servidor do Next abre filhos: mata o grupo inteiro, senão a porta fica presa.
  [ -n "$PID_WEB" ] && kill -- "-$PID_WEB" 2>/dev/null || true
  [ -n "$PID_API" ] && kill -TERM "$PID_API" 2>/dev/null && wait "$PID_API" 2>/dev/null || true
  rm -rf "$TMP"
}
trap encerrar EXIT

cd "$RAIZ"
INICIO=$(date +%s)
node "$VITE_NODE" tests/e2e/api-render-telas.ts -- --porta "$PORTA_API" --pronto "$TMP/dados.json" &
PID_API=$!

if [ "${RENDER_SEM_BUILD:-0}" != "1" ] || [ ! -f apps/web/.next/BUILD_ID ]; then
  echo "[render] next build (modo de produção)" >&2
  (cd apps/web && npx next build >"$SAIDA/web-build.log" 2>&1) || { tail -40 "$SAIDA/web-build.log" >&2; exit 1; }
fi
# Como em produção (apps/web/Dockerfile): o servidor standalone, com os estáticos do build ao lado (o `next start` não roda
# com `output: standalone`).
STANDALONE="apps/web/.next/standalone/apps/web"
rm -rf "$STANDALONE/.next/static" && cp -r apps/web/.next/static "$STANDALONE/.next/static"
(MACUXIERP_API_URL="http://127.0.0.1:$PORTA_API" NODE_ENV=production PORT="$PORTA_WEB" HOSTNAME=127.0.0.1 exec setsid node "$STANDALONE/server.js" >"$SAIDA/web.log" 2>&1) &
PID_WEB=$!

for _ in $(seq 1 180); do
  kill -0 "$PID_API" 2>/dev/null || break
  [ -s "$TMP/dados.json" ] && curl -s -o /dev/null "http://localhost:$PORTA_WEB/login" && break
  sleep 1
done
[ -s "$TMP/dados.json" ] || { echo "API não subiu" >&2; exit 1; }
curl -s -o /dev/null "http://localhost:$PORTA_WEB/login" || { echo "web não subiu" >&2; tail -40 "$SAIDA/web.log" >&2; exit 1; }

set +e
node tests/e2e/render-telas.mjs --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --log "$SAIDA/web.log" --html "$SAIDA/html"
CODIGO=$?
set -e
echo "[render] tempo total (build incluso): $(( $(date +%s) - INICIO )) s" >&2
exit "$CODIGO"
