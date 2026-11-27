#!/usr/bin/env bash
# R-20261127-061730 (v0.3.20): e2e do login único entre o BKO e o /config, e do link do e-mail (`/login#codigo=…&email=…`).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem rede.
# Uso: bash tests/e2e/rodar-login-config.sh [pasta dos prints]   (portas: API 3204, web 3104)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT
cd "$RAIZ"
rodar_roteiro_dev tests/e2e/api-login-config.ts tests/e2e/login-config.mjs "${PORTA_API:-3204}" "${PORTA_WEB:-3104}" "${1:-$TMP/prints}"
