#!/usr/bin/env bash
# T-0008 (d) e PF-3 da v0.3.13: roda o e2e do BKO de cadastro (dois tenants) com as telas reais (next dev) e a API real
# (tests/e2e/api-real.ts, banco efêmero). Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`).
# Uso: bash tests/e2e/rodar-bko-cadastro.sh [pasta dos prints]   (portas: API 3200, web 3100)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT
cd "$RAIZ"
rodar_roteiro_dev tests/e2e/api-real.ts tests/e2e/bko-cadastro.mjs "${PORTA_API:-3200}" "${PORTA_WEB:-3100}" "${1:-$TMP/prints}"
