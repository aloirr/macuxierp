#!/usr/bin/env bash
# Instalador do Macuxi Conector (ERP) para Linux com systemd.
# ADR 0014, seção 6 item 4. Idempotente: pode rodar de novo para atualizar.
# Layout do tar.gz do workflow conector-montar.yml (pasta macuxi-conector-<versao>-linux/):
#   conector.mjs  exemplos/  linux/{instalar.sh, macuxi-conector.service, LEIAME-LINUX.md}  LEIAME.md  VERSAO.txt  SHA256SUMS
# Uso (como root, na pasta extraída do pacote): sudo bash linux/instalar.sh
# Nunca grava segredo real: o segredos.env é criado só como modelo vazio.
set -euo pipefail

USUARIO="macuxi-conector"
DIR_APP="/opt/macuxi-conector"
DIR_CONF="/etc/macuxi-conector"
DIR_DADOS="/var/lib/macuxi-conector"
UNIDADE="/etc/systemd/system/macuxi-conector.service"
NODE_MIN_MAIOR=24
NODE_MIN_MENOR=7

# ORIGEM = linux/ (onde está este script); PACOTE = raiz da pasta extraída (conector.mjs, exemplos/).
ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACOTE="$(cd "${ORIGEM}/.." && pwd)"

falhar() { echo "ERRO: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || falhar "rode como root (sudo bash linux/instalar.sh)."
command -v systemctl >/dev/null 2>&1 || falhar "systemd não encontrado."

# 1. Node >= 24.7 em /usr/bin/node (o caminho da unidade systemd)
[[ -x /usr/bin/node ]] || falhar "Node não encontrado em /usr/bin/node. Instale o Node ${NODE_MIN_MAIOR}.${NODE_MIN_MENOR}+ (pacote da distribuição ou NodeSource)."
VERSAO_NODE="$(/usr/bin/node -p 'process.versions.node')"
IFS='.' read -r N_MAIOR N_MENOR _ <<<"${VERSAO_NODE}"
if (( N_MAIOR < NODE_MIN_MAIOR )) || { (( N_MAIOR == NODE_MIN_MAIOR )) && (( N_MENOR < NODE_MIN_MENOR )); }; then
  falhar "Node ${VERSAO_NODE} encontrado; o Conector pede ${NODE_MIN_MAIOR}.${NODE_MIN_MENOR} ou mais novo."
fi
echo "Node ${VERSAO_NODE}: ok."

# 2. Arquivos do pacote (layout do tar.gz do workflow)
for f in conector.mjs LEIAME.md exemplos/conector.thathyany.exemplo.json linux/macuxi-conector.service linux/LEIAME-LINUX.md; do
  [[ -f "${PACOTE}/${f}" ]] || falhar "arquivo do pacote ausente: ${f} (rode na pasta extraída do macuxi-conector-<versao>-linux.tar.gz)"
done

# 3. Usuário de sistema sem login
if id -u "${USUARIO}" >/dev/null 2>&1; then
  echo "Usuário ${USUARIO}: já existe."
else
  useradd --system --no-create-home --home-dir "${DIR_DADOS}" --shell /usr/sbin/nologin --user-group "${USUARIO}"
  echo "Usuário ${USUARIO}: criado."
fi

# 4. Aplicação em /opt (root é dono; o serviço só lê)
install -d -o root -g root -m 0755 "${DIR_APP}" "${DIR_APP}/exemplos"
install -o root -g root -m 0644 "${PACOTE}/conector.mjs" "${DIR_APP}/conector.mjs"
install -o root -g root -m 0644 "${PACOTE}/LEIAME.md" "${DIR_APP}/LEIAME.md"
install -o root -g root -m 0644 "${ORIGEM}/LEIAME-LINUX.md" "${DIR_APP}/LEIAME-LINUX.md"
install -o root -g root -m 0644 "${PACOTE}/exemplos/conector.thathyany.exemplo.json" "${DIR_APP}/exemplos/conector.thathyany.exemplo.json"
echo "Aplicação: ${DIR_APP}."

# 5. Configuração em /etc (0750, grupo do serviço)
install -d -o root -g "${USUARIO}" -m 0750 "${DIR_CONF}"

if [[ -e "${DIR_CONF}/segredos.env" ]]; then
  echo "segredos.env: já existe, mantido sem mudança."
else
  ( umask 077
    cat > "${DIR_CONF}/segredos.env" <<'MODELO'
# Segredos do Macuxi Conector. Dono root:root, modo 0600. Nunca versionar,
# nunca colar em chat, recado ou log. Preencha os valores depois do "=".
MACUXI_CONECTOR_ERP_SENHA=
MACUXI_CONECTOR_HUB_CHAVE=
MODELO
  )
  echo "segredos.env: modelo vazio criado (preencha antes de ligar o serviço)."
fi
chown root:root "${DIR_CONF}/segredos.env"
chmod 0600 "${DIR_CONF}/segredos.env"

if [[ -e "${DIR_CONF}/conector.json" ]]; then
  echo "conector.json: já existe, mantido sem mudança."
else
  install -o root -g "${USUARIO}" -m 0640 "${PACOTE}/exemplos/conector.thathyany.exemplo.json" "${DIR_CONF}/conector.json"
  echo "conector.json: copiado do exemplo (revise antes de ligar o serviço)."
fi

# 6. Pasta de dados (o systemd também garante pelo StateDirectory)
install -d -o "${USUARIO}" -g "${USUARIO}" -m 0750 "${DIR_DADOS}"

# 7. Unidade systemd
install -o root -g root -m 0644 "${ORIGEM}/macuxi-conector.service" "${UNIDADE}"
systemctl daemon-reload
echo "Unidade: ${UNIDADE}."

echo
echo "Instalação concluída. Depois de preencher ${DIR_CONF}/segredos.env e revisar ${DIR_CONF}/conector.json:"
echo "  systemctl enable --now macuxi-conector"
