#!/usr/bin/env bash
# T-0056 (E3): roda o e2e do portal /config + BKO (Integração FDV) com as telas reais (next dev) e a API real (banco efêmero).
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem instalar nada.
# Uso: bash tests/e2e/rodar-portal-integracao.sh [pasta dos prints]   (portas: API 3201, web 3101)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT
cd "$RAIZ"
rodar_roteiro_dev tests/e2e/api-portal-integracao.ts tests/e2e/portal-integracao.mjs "${PORTA_API:-3201}" "${PORTA_WEB:-3101}" "${1:-$TMP/prints}"
