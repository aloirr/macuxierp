#!/usr/bin/env bash
# X-6 da v0.3.12 (T-0089): abre todas as telas do web em modo de produção (next build + servidor standalone) contra a API
# real (banco efêmero) e falha em qualquer erro de render (tests/e2e/render-telas.mjs; critérios no X-6 do plano v0.3.12).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-render-telas.sh [pasta de saída]   (portas: API 3202, web 3102; RENDER_SEM_BUILD=1 reaproveita o .next)
# MENU_ACOES=1: depois do X-6, no mesmo servidor, roda o e2e do botão "Ações" (T-0099, tests/e2e/menu-acoes.mjs), com os
# prints do menu aberto em 1280 e 390 em <pasta de saída>/menu-acoes.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
SAIDA="${1:-$TMP}"
mkdir -p "$SAIDA"
PORTA_API="${PORTA_API:-3202}"
PORTA_WEB="${PORTA_WEB:-3102}"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT

cd "$RAIZ"
INICIO=$(date +%s)
subir_api tests/e2e/api-render-telas.ts "$PORTA_API"

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
esperar_web "http://localhost:$PORTA_WEB/login" || { tail -40 "$SAIDA/web.log" >&2; exit 1; }

set +e
node tests/e2e/render-telas.mjs --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --log "$SAIDA/web.log" --html "$SAIDA/html"
CODIGO=$?
if [ "${MENU_ACOES:-0}" = "1" ]; then
  node tests/e2e/menu-acoes.mjs --base "http://localhost:$PORTA_WEB" --dados "$TMP/dados.json" --saida "$SAIDA/menu-acoes" || CODIGO=1
fi
set -e
echo "[render] tempo total (build incluso): $(( $(date +%s) - INICIO )) s" >&2
exit "$CODIGO"
