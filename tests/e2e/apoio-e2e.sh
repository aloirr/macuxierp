#!/usr/bin/env bash
# Apoio comum dos executores dos e2e (rodar-render-telas.sh, rodar-portal-integracao.sh). Uso: `source` depois de definir
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
