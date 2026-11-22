#!/usr/bin/env bash
# Alerta de saúde da produção do Macuxi ERP (T-0024, ADR 0003; molde do alerta do FDV). Lê o /v1/saude da API do ERP pelo
# loopback da VM (127.0.0.1:8200; a 8100 é do FDV) e avisa quando o estado MUDA.
#
# A /v1/saude do ERP devolve {status, versao, banco} (apps/api/src/app.ts):
#   - 200 com "banco":"ok"            → estado "ok";
#   - resposta sem "banco":"ok" (503) → estado "degradado" (a API está no ar, o banco não);
#   - sem resposta                    → estado "fora".
# Aviso: sempre no syslog (`logger -t macuxierp-alerta`; ver com `journalctl -t macuxierp-alerta`) e, se existir
# /opt/macuxierp/alerta.env com MACUXI_ALERTA_WEBHOOK (hoje não é gravado: webhook desligado no deploy), um POST
# com o texto. Só leitura: não reinicia nada, não mexe no banco.
#
# Instalação: pelo deploy (preparar-vm.sh copia para /opt/macuxierp/alerta-saude.sh e liga o macuxierp-alerta.timer, a cada
# 5 min, como o usuário de deploy). Conferir: systemctl list-timers macuxierp-alerta.timer.
# Teste manual: /opt/macuxierp/alerta-saude.sh --mostrar   (imprime o estado e o corpo, sem avisar)
set -u

URL="${MACUXIERP_SAUDE_URL:-http://127.0.0.1:8200/v1/saude}"
ESTADO_ARQ="${MACUXIERP_ALERTA_ESTADO:-/opt/macuxierp/.alerta.estado}"
ENV_ARQ="${MACUXIERP_ALERTA_ENV:-/opt/macuxierp/alerta.env}"

# sem -f: o 503 do banco fora também traz o corpo
resposta="$(curl -sS -m 10 -w '\n%{http_code}' "$URL" 2>/dev/null)"
codigo="$(printf '%s' "$resposta" | tail -n 1)"
corpo="$(printf '%s' "$resposta" | sed '$d')"
if [ -z "$corpo" ] || [ "$codigo" = 000 ]; then
  estado="fora"
  detalhe="a API do ERP não respondeu em ${URL}"
elif [ "$codigo" = 200 ] && printf '%s' "$corpo" | grep -q '"banco":"ok"'; then
  estado="ok"
  detalhe="banco ok"
else
  estado="degradado"
  detalhe="HTTP ${codigo}, $(printf '%s' "$corpo" | grep -o '"banco":"[^"]*"' | head -n 1)"
fi

if [ "${1:-}" = "--mostrar" ]; then
  printf 'estado=%s %s\n%s\n' "$estado" "$detalhe" "$corpo"
  exit 0
fi

anterior="$(cat "$ESTADO_ARQ" 2>/dev/null || echo "desconhecido")"
[ "$estado" = "$anterior" ] && exit 0
printf '%s' "$estado" > "$ESTADO_ARQ"

texto="Macuxi ERP producao: ${anterior} -> ${estado} (${detalhe}) em $(TZ=America/Manaus date +'%d/%m/%Y %H:%M') de Manaus"
logger -t macuxierp-alerta "$texto" 2>/dev/null || echo "$texto" >&2

if [ -f "$ENV_ARQ" ]; then
  webhook="$(sed -n 's/^MACUXI_ALERTA_WEBHOOK=//p' "$ENV_ARQ" | tail -n 1 | tr -d "\"'\r")"
  if [ -n "$webhook" ]; then
    # a URL do webhook vai pelo stdin (-K -), não pelo argv (visível no ps)
    printf 'url = "%s"\n' "$webhook" |
      curl -fsS -m 10 -K - -H 'Content-Type: text/plain; charset=utf-8' --data-binary "$texto" >/dev/null 2>&1 ||
      logger -t macuxierp-alerta "falha ao enviar o aviso ao webhook" 2>/dev/null
  fi
fi
exit 0
