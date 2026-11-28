#!/usr/bin/env bash
# Diagnóstico de produção do Macuxi ERP (v0.3.27): roda o diagnostico.sql (ao lado) pelo serviço psql do compose.yml.
# Ver ADR 0003, item 2 e T-0120.
#
#   bash diagnostico.sh           (em qualquer pasta; usa /opt/macuxierp, ou MACUXIERP_DIR)
#
# Quem chama: o workflow producao-diagnostico.yml (governança) ou o operador, à mão, na VM. Além do READ ONLY do SQL, o
# PGOPTIONS liga default_transaction_read_only e um statement_timeout de 30 s (o servidor é o mesmo do FDV). Pega a trava
# da VM (/var/lock/macuxi-producao-vm.lock, a do implantar.sh) antes do docker compose: nunca no meio de uma publicação.
# Nenhum segredo é impresso: a senha do admin só existe no admin.env e no ambiente do contêiner.
# Saída 0 = diagnóstico impresso; 2 = opção, arquivo ou banco inválido; outro código = falha do psql (o dele).
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

erro() { echo "[diagnostico] ERRO: $2" >&2; exit "$1"; }
[ $# -eq 0 ] || erro 2 "sem opções (recebido: $1)"
PASTA="${MACUXIERP_DIR:-/opt/macuxierp}"

SQL="$ORIGEM/diagnostico.sql"
[ -s "$SQL" ] || erro 2 "$SQL ausente (o workflow copia scripts/deploy/producao/* junto com este script)"
cd "$PASTA"
for f in .env gerados.env banco.env admin.env imagens.env; do
  [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (quem grava: env.modelo)"
done
BANCO="$(valor_env .env MACUXIERP_BANCO)"
BANCO="${BANCO:-macuxierp}"
[[ "$BANCO" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || erro 2 "MACUXIERP_BANCO inválido no .env (só minúsculas, dígitos e _)"

# Trava da VM (a mesma do implantar.sh e do FDV; ADR 0003, item 2): o diagnóstico não roda no meio de uma publicação.
# Espera até MACUXI_TRAVA_ESPERA_S (padrão 600 s); MACUXIERP_TRAVA_VM só existe para o teste apontar outro arquivo.
TRAVA="${MACUXIERP_TRAVA_VM:-/var/lock/macuxi-producao-vm.lock}"
ESPERA_MAX="${MACUXI_TRAVA_ESPERA_S:-600}"
[[ "$ESPERA_MAX" =~ ^[0-9]{1,5}$ ]] || erro 2 "MACUXI_TRAVA_ESPERA_S inválido"
exec 9>"$TRAVA" || erro 1 "sem acesso à trava $TRAVA (o preparar-vm.sh a cria, grupo docker, 660)"
flock -w "$ESPERA_MAX" 9 || erro 1 "a trava da VM ficou ocupada por mais de ${ESPERA_MAX} s (deploy do FDV ou do ERP em andamento): nada foi lido"

echo "[diagnostico] $(date -u +%Y-%m-%dT%H:%M:%SZ) banco $BANCO, só leitura (trava da VM obtida)"
# O SQL vai pelo stdin: o contêiner não vê o disco do host.
st=0
dc --profile ferramentas run --rm --no-deps -T \
  -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' \
  psql psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -A -F ' | ' -d "$BANCO" -f - < "$SQL" || st=$?
[ "$st" = 0 ] || erro "$st" "psql falhou (código $st; veja a linha do psql acima); nada foi alterado"
echo "[diagnostico] pronto"
