#!/usr/bin/env bash
# T-0101, R-2 (e2e da tela): "Atualizar pela Receita" no /config com a fonte dublada, nas falhas da fonte, em 1280 e 390.
# Pré-requisito: Postgres local de pé (`eval "$(bash db/scripts/pg-local.sh --subir)"`). Sem Docker, sem rede.
# Uso: bash tests/e2e/rodar-ficha-receita.sh [pasta dos prints]   (portas: API 3203, web 3103)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck source=tests/e2e/apoio-e2e.sh
source "$RAIZ/tests/e2e/apoio-e2e.sh"
trap encerrar_e2e EXIT
cd "$RAIZ"
rodar_roteiro_dev tests/e2e/api-ficha-receita.ts tests/e2e/ficha-receita-falha.mjs "${PORTA_API:-3203}" "${PORTA_WEB:-3103}" "${1:-$TMP/prints}"
