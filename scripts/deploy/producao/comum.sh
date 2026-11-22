# shellcheck shell=bash
# Comum aos scripts de produção do Macuxi ERP (T-0024, ADR 0003). Carregado com source (molde do ghcr-tentar.sh) pelo
# implantar.sh, banco.sh e preparar-vm.sh, que ficam ao lado dele (o workflow copia scripts/deploy/producao/* para a VM).
# À mão, na VM:  cd /opt/macuxierp && source ~/macuxierp-deploy/comum.sh && dc ps
# Arquivos e variáveis de ambiente: env.modelo (lista única).

REDE_TUNEL_PADRAO=macuxi-prod_macuxi # rede "macuxi" do projeto Compose macuxi-prod do FDV (túnel da Cloudflare)

valor_env() { # arquivo nome → valor (última linha, sem aspas nem \r); arquivo ausente = vazio. Nunca imprime em log.
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1 | tr -d "\"'\r"
}

rede_tunel() { # [pasta] → MACUXIERP_REDE_TUNEL do .env da pasta (padrão: a atual) ou REDE_TUNEL_PADRAO
  local r
  r="$(valor_env "${1:-.}/.env" MACUXIERP_REDE_TUNEL)"
  printf '%s\n' "${r:-$REDE_TUNEL_PADRAO}"
}

dc() { # docker compose do projeto macuxierp na pasta atual (/opt/macuxierp), com os arquivos de interpolação
  MACUXIERP_REDE_TUNEL="$(rede_tunel)" \
    docker compose --env-file .env --env-file gerados.env --env-file banco.env --env-file imagens.env "$@"
}
