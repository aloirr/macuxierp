#!/usr/bin/env bash
# Apoio comum dos executores dos e2e (rodar-render-telas.sh, rodar-portal-integracao.sh, rodar-bko-cadastro.sh). Uso: `source` depois de definir
# RAIZ e TMP. Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`); sem Docker, sem instalar nada.

export MACUXI_DB_MIGRACOES="${MACUXI_DB_MIGRACOES:-$RAIZ/db/migrations}"
VITE_NODE="$(ls -d "$RAIZ"/node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs | head -1)"
PID_API=""
PID_WEB=""

# subir_api <servidor .ts> <porta>: sobe a API do e2e em segundo plano (PID_API); o JSON de pronto vai em $TMP/dados.json.
subir_api() {
  (cd "$RAIZ" && exec node "$VITE_NODE" "$1" -- --porta "$2" --pronto "$TMP/dados.json") &
  PID_API=$!
}

# esperar_web <url do web>: espera até 180 s pelo JSON de pronto da API e pela resposta do web; sai 1 se um deles não subiu.
esperar_web() {
  for _ in $(seq 1 180); do
    kill -0 "$PID_API" 2>/dev/null || break
    [ -s "$TMP/dados.json" ] && curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  [ -s "$TMP/dados.json" ] || { echo "API não subiu" >&2; return 1; }
  curl -s -o /dev/null "$1" || { echo "web não subiu ($1)" >&2; return 1; }
}

# encerrar_e2e: para o web (o grupo inteiro: o Next abre filhos e a porta ficaria presa), a API (apaga o banco) e o TMP.
encerrar_e2e() {
  [ -n "$PID_WEB" ] && kill -- "-$PID_WEB" 2>/dev/null || true
  [ -n "$PID_API" ] && kill -TERM "$PID_API" 2>/dev/null && wait "$PID_API" 2>/dev/null || true
  rm -rf "$TMP"
}

# rodar_roteiro_dev <servidor .ts> <roteiro .mjs> <porta API> <porta web> <pasta dos prints>: sobe a API e o next dev
# (apps/web) e roda o roteiro com --base, --dados e --saida; sai com o código do roteiro (log do web no fim, se falhar).
rodar_roteiro_dev() {
  subir_api "$1" "$3"
  (cd "$RAIZ/apps/web" && MACUXIERP_API_URL="http://127.0.0.1:$3" exec setsid npx next dev -p "$4" >"$TMP/web.log" 2>&1) &
  PID_WEB=$!
  esperar_web "http://localhost:$4/login" || { tail -40 "$TMP/web.log" >&2; return 1; }
  local inicio codigo
  inicio=$(date +%s)
  set +e
  node "$RAIZ/$2" --base "http://localhost:$4" --dados "$TMP/dados.json" --saida "$5"
  codigo=$?
  set -e
  echo "[e2e] tempo: $(( $(date +%s) - inicio )) s" >&2
  [ "$codigo" -ne 0 ] && tail -40 "$TMP/web.log" >&2
  return "$codigo"
}
