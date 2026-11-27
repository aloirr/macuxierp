#!/usr/bin/env bash
# Preparo do Macuxi ERP na VM de produção do FDV (T-0024, ADR 0003). IDEMPOTENTE e MÍNIMO: o workflow "producao — publicar"
# roda a cada publicação e só cria o que falta.
#
#   sudo bash preparar-vm.sh [usuario-de-deploy]      (padrão: o usuário que chamou o sudo)
#   bash preparar-vm.sh --conferir-banco              (SÓ LEITURA, como o usuário de deploy: banco.sh --so-conferir)
#
# A VM é do FDV, já preparada pelo preparar-vm.sh dele (Docker, Compose, fuso, sshd, fail2ban, atualizações automáticas,
# daemon.json com a rotação de log e as faixas de rede). Este script NÃO mexe em nada disso e NUNCA reinicia o Docker
# (derrubaria o FDV). Só:
#   1. confere root, o usuário de deploy e o docker compose;
#   2. /opt/macuxierp (dono o usuário, 750) e /opt/macuxierp/certs;
#   3. /var/lock/macuxi-producao-vm.lock (grupo docker, 660): a trava compartilhada com o FDV (ADR 0003, item 2);
#   4. arquivos de ambiente: ambiente-vm.sh (lista em env.modelo);
#   5. confere a rede do túnel do FDV (só aviso: o implantar.sh é que falha sem ela);
#   6. alerta de saúde: /opt/macuxierp/alerta-saude.sh e o timer macuxierp-alerta.timer (5 min, como o usuário de deploy).
#      Nomes próprios: os macuxi-* do FDV não são tocados;
#   7. imprime o roteiro do banco (criado pelo banco.sh no implantar.sh, sem superusuário). Este script não roda SQL.
# Quem grava cada arquivo: env.modelo. O workflow entra com PROD_SSH_KEY, PROD_HOST e PROD_USER e, depois deste script,
# grava o email.env com os PROD_SMTP_* (email-env.sh, T-0076).
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"
PASTA=/opt/macuxierp
TRAVA=/var/lock/macuxi-producao-vm.lock
log() { echo "[preparar-vm] $*"; }

# ---------- conferência do banco (só leitura; o mesmo caminho do banco.sh do implantar) ----------
if [ "${1:-}" = "--conferir-banco" ]; then
  for f in admin.env banco.env; do
    [ -s "$PASTA/$f" ] || { echo "[preparar-vm] $PASTA/$f ausente: o sudo bash preparar-vm.sh copia do /opt/macuxi; nada a conferir ainda" >&2; exit 1; }
  done
  MACUXIERP_DIR="$PASTA" exec bash "$ORIGEM/banco.sh" --so-conferir
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "[preparar-vm] rode com sudo" >&2
  exit 1
fi

USUARIO="${1:-${SUDO_USER:-}}"
if [ -z "$USUARIO" ] || ! id "$USUARIO" >/dev/null 2>&1; then
  echo "[preparar-vm] usuário de deploy '${USUARIO}' não existe (sudo bash preparar-vm.sh <usuario>)" >&2
  exit 1
fi

# ---------- 1. Docker e Compose (do FDV) ----------
if ! docker compose version >/dev/null 2>&1; then
  echo "[preparar-vm] docker compose ausente: a VM do FDV deve estar preparada antes (preparar-vm.sh do FDV); nada foi feito" >&2
  exit 1
fi
if ! id -nG "$USUARIO" | tr ' ' '\n' | grep -qx docker; then
  echo "[preparar-vm] $USUARIO fora do grupo docker: a VM do FDV deve estar preparada antes; nada foi feito" >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "[preparar-vm] openssl ausente (vem com o preparo do FDV)" >&2; exit 1; }
command -v flock >/dev/null 2>&1 || { echo "[preparar-vm] flock ausente (pacote util-linux)" >&2; exit 1; }

# ---------- 2. pastas ----------
install -d -m 750 -o "$USUARIO" -g "$USUARIO" "$PASTA"
# certs/: só a CA pública do DBaaS (644), lida pelo usuário node dos contêineres pelo volume ./certs:/certs:ro
install -d -m 755 -o "$USUARIO" -g "$USUARIO" "$PASTA/certs"

# ---------- 3. trava compartilhada com o FDV ----------
if [ ! -e "$TRAVA" ]; then
  install -m 660 -o root -g docker /dev/null "$TRAVA"
  log "trava $TRAVA criada (grupo docker, 660)"
else
  # se o FDV criou antes com outro modo, só garante que o grupo docker escreve (sem trocar o dono)
  [ "$(stat -c %G "$TRAVA")" = docker ] || chgrp docker "$TRAVA"
  chmod g+rw "$TRAVA"
fi

# ---------- 4. arquivos de ambiente (gerados, chaves do .env e configuração do FDV) ----------
bash "$ORIGEM/ambiente-vm.sh" "$USUARIO"

# ---------- 5. rede do túnel do FDV ----------
REDE_TUNEL="$(rede_tunel "$PASTA")"
if docker network inspect "$REDE_TUNEL" >/dev/null 2>&1; then
  log "rede do túnel do FDV: $REDE_TUNEL"
else
  echo "::warning::rede do túnel do FDV '$REDE_TUNEL' não existe (FDV fora do ar ou outro nome: MACUXIERP_REDE_TUNEL no .env)"
fi

# ---------- 6. alerta de saúde ----------
gravar_unidade() { # caminho conteúdo: grava só se mudou; devolve 0 se gravou
  if [ "$(cat "$1" 2>/dev/null)" != "$2" ]; then
    printf '%s\n' "$2" > "$1"; chmod 644 "$1"; return 0
  fi
  return 1
}
if [ -f "$ORIGEM/alerta-saude.sh" ]; then
  if ! cmp -s "$ORIGEM/alerta-saude.sh" "$PASTA/alerta-saude.sh" 2>/dev/null; then
    install -m 755 -o root -g root "$ORIGEM/alerta-saude.sh" "$PASTA/alerta-saude.sh"
    log "alerta: $PASTA/alerta-saude.sh atualizado"
  fi
else
  echo "::warning::alerta: $ORIGEM/alerta-saude.sh ausente (o workflow copia junto)"
fi
mudou=0
gravar_unidade /etc/systemd/system/macuxierp-alerta.service "# Gerado por scripts/deploy/producao/preparar-vm.sh do Macuxi ERP (T-0024). Não edite à mão.
[Unit]
Description=Macuxi ERP producao: alerta de saude (/v1/saude de dentro do conteiner da api)
ConditionPathExists=$PASTA/alerta-saude.sh

[Service]
Type=oneshot
User=$USUARIO
Group=$USUARIO
Environment=MACUXIERP_ALERTA_ENV=$PASTA/alerta.env
Environment=MACUXIERP_ALERTA_ESTADO=$PASTA/.alerta.estado
ExecStart=$PASTA/alerta-saude.sh
TimeoutStartSec=60" && mudou=1
gravar_unidade /etc/systemd/system/macuxierp-alerta.timer "# Gerado por scripts/deploy/producao/preparar-vm.sh do Macuxi ERP (T-0024). Não edite à mão.
[Unit]
Description=Macuxi ERP producao: alerta de saude a cada 5 minutos

[Timer]
OnBootSec=4min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target" && mudou=1
if [ "$mudou" = 1 ]; then
  systemctl daemon-reload || echo "::warning::systemctl daemon-reload falhou"
  log "alerta: unidades gravadas"
fi
if ! systemctl is-enabled --quiet macuxierp-alerta.timer || ! systemctl is-active --quiet macuxierp-alerta.timer; then
  systemctl enable --now macuxierp-alerta.timer >/dev/null 2>&1 \
    && log "macuxierp-alerta.timer ligado" \
    || echo "::warning::não consegui ligar o macuxierp-alerta.timer (systemctl status macuxierp-alerta.timer)"
elif [ "$mudou" = 1 ]; then
  systemctl restart macuxierp-alerta.timer || echo "::warning::restart do macuxierp-alerta.timer falhou"
fi

log "pronto: $PASTA (dono $USUARIO), trava $TRAVA, compose $(docker compose version --short)"

# ---------- 7. roteiro do banco (nada é executado aqui; sem senha em argv ou log) ----------
conferir="bash ~/macuxierp-deploy/preparar-vm.sh --conferir-banco   (só leitura, como $USUARIO)"
cat <<ROTEIRO
[preparar-vm] banco do ERP no DBaaS do FDV, sem superusuário:
  1. o admin do DBaaS (o mesmo do FDV: /opt/macuxi/admin.env → admin.env) precisa de CREATEDB e CREATEROLE, NOSUPERUSER;
  2. o banco.sh, chamado pelo implantar.sh, cria o banco macuxierp se faltar, aplica as migrações (a 0001 cria
     macuxierp_app, macuxierp_worker e macuxierp_leitura) e aplica as senhas do gerados.env por verificador SCRAM;
  3. conferir: $conferir
     ou, no psql como o admin: SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'macuxierp_%';
ROTEIRO
