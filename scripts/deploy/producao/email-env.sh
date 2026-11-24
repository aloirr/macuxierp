#!/usr/bin/env bash
# E-mail transacional da produção ("esqueci a senha", T-0076): /opt/macuxierp/email.env, lido SÓ pela macuxierp-api
# (compose.yml). Os valores vêm dos secrets PROD_SMTP_* do environment PRODUCAO; nenhum valor vai para argv nem log.
#
#   bash email-env.sh conferir         (runner) confere os 6 PROD_SMTP_* do ambiente; erro com SÓ os nomes
#   bash email-env.sh enviar <usuario> (runner) confere, mascara (::add-mask::) e manda o arquivo pelo stdin do ssh ao
#                                      "email-env.sh gravar" copiado em ~/macuxierp-deploy (host "prod" do ~/.ssh/config)
#   bash email-env.sh gravar           (VM, usuário de deploy) lê o arquivo do stdin, confere as 7 chaves e grava
#                                      $MACUXIERP_DIR/email.env (padrão /opt/macuxierp) com 600, atômico e idempotente
#
# Dono e modo: /opt/macuxierp é do usuário de deploy (750, preparar-vm.sh), então o usuário de deploy grava direto, sem
# sudo, com o mesmo dono/grupo dos outros *.env (o ambiente-vm.sh também os deixa assim a cada publicação).
# Formato (env_file do Compose 2.24+, compose-go/dotenv): cada valor entre aspas SIMPLES (literal: $, #, espaço e aspas
# duplas passam como estão, sem interpolação). Valor com aspa simples ou barra invertida vai entre aspas DUPLAS, com
# \ → \\, " → \" e $ → \$ (o dotenv do Compose desfaz os três). Quebra de linha é recusada (não cabe numa linha).
# MACUXIERP_DIR troca a pasta SÓ para teste.
set -euo pipefail
set +x
log() { echo "[email-env] $*"; }
erro() { echo "::error::$*" >&2; exit 1; }
uma_vez() { # contagem nome: só 1 passa; 0 é "sem", 2 ou mais é "repetida" (a mensagem diz quantas)
  [ "$1" -eq 1 ] && return 0
  [ "$1" -eq 0 ] && erro "email.env recebido sem $2: nada foi trocado"
  erro "email.env recebido com $2 repetida ($1 vezes): nada foi trocado"
}

# a lista única: secret PROD_SMTP_<n> → MACUXI_SMTP_<n> no email.env (o resto é derivado dela)
NOMES=(HOST PORTA TLS USUARIO SENHA REMETENTE)
SECRETS=("${NOMES[@]/#/PROD_SMTP_}")
# valores do MACUXI_SMTP_TLS: os mesmos do FDV (starttls na 587, tls implícito na 465)
TLS_ACEITOS='^(starttls|tls)$'
CHAVES="^MACUXI_(SMTP_($(IFS='|'; echo "${NOMES[*]}"))|EMAIL_TRANSPORTE)="
TMP=''
trap 'rm -f "$TMP"' EXIT

conferir() {
  local n v falta=()
  for n in "${SECRETS[@]}"; do
    [ -n "${!n:-}" ] || falta+=("$n")
  done
  [ ${#falta[@]} -eq 0 ] || erro "faltam secrets do e-mail no environment PRODUCAO: ${falta[*]}"
  for n in "${SECRETS[@]}"; do
    v="${!n}"
    case "$v" in *$'\n'* | *$'\r'*) erro "$n tem quebra de linha (o valor é de uma linha só)" ;; esac
  done
  [[ "$PROD_SMTP_HOST" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || erro "PROD_SMTP_HOST inválido (só o nome do servidor)"
  [[ "$PROD_SMTP_PORTA" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$PROD_SMTP_PORTA))" -ge 1 ] && [ "$((10#$PROD_SMTP_PORTA))" -le 65535 ] \
    || erro "PROD_SMTP_PORTA inválida (só dígitos, 1 a 65535)"
  [[ "$PROD_SMTP_TLS" =~ $TLS_ACEITOS ]] || erro "PROD_SMTP_TLS inválido (starttls ou tls)"
}

linha() { # nome valor → NOME='valor' (ou "valor" escapado); nunca vai para o log
  local v="$2"
  case "$v" in
    *\'* | *\\*)
      v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; v="${v//\$/\\\$}"
      printf '%s="%s"\n' "$1" "$v" ;;
    *) printf "%s='%s'\n" "$1" "$v" ;;
  esac
}

montar() { # conteúdo do email.env (stdout só para o arquivo temporário)
  local n s
  for n in "${NOMES[@]}"; do
    s="PROD_SMTP_$n"
    if [ "$n" = PORTA ]; then linha "MACUXI_SMTP_$n" "$((10#${!s}))"; else linha "MACUXI_SMTP_$n" "${!s}"; fi
  done
  linha MACUXI_EMAIL_TRANSPORTE smtp
}

enviar() {
  local usuario="${1:-}" n l
  [[ "$usuario" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || erro "usuário de deploy inválido (bash email-env.sh enviar <usuario>)"
  conferir
  umask 077
  TMP="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/email-env.XXXXXX")"
  montar > "$TMP"
  # máscara de cada valor e da forma gravada (o GitHub já mascara o secret; a linha escapada é derivada)
  for n in "${SECRETS[@]}"; do echo "::add-mask::${!n}"; done
  while IFS= read -r l; do echo "::add-mask::${l#*=}"; done < "$TMP"
  ssh -l "$usuario" prod 'bash ~/macuxierp-deploy/email-env.sh gravar' < "$TMP" || erro "email.env não foi gravado na VM"
  log "email.env enviado à VM (7 variáveis; valores fora do log)"
}

gravar() {
  local pasta="${MACUXIERP_DIR:-/opt/macuxierp}" n
  [ -d "$pasta" ] && [ -w "$pasta" ] || erro "$pasta ausente ou sem escrita para $(id -un): o preparar-vm.sh cria antes"
  umask 077
  TMP="$(mktemp "$pasta/.email.env.XXXXXX")"
  cat > "$TMP"
  # só as 7 chaves conhecidas, uma vez cada; nada é trocado se faltar ou sobrar linha
  [ "$(grep -cvE "$CHAVES" "$TMP" || :)" -eq 0 ] || erro "email.env recebido com linha fora das 7 chaves: nada foi trocado"
  for n in "${NOMES[@]}"; do
    uma_vez "$(grep -c "^MACUXI_SMTP_$n=" "$TMP" || :)" "MACUXI_SMTP_$n"
  done
  uma_vez "$(grep -cx "MACUXI_EMAIL_TRANSPORTE='smtp'" "$TMP" || :)" MACUXI_EMAIL_TRANSPORTE
  chmod 600 "$TMP"
  if cmp -s "$TMP" "$pasta/email.env"; then
    chmod 600 "$pasta/email.env"
    log "$pasta/email.env sem mudança (600)"
    return 0
  fi
  mv -f "$TMP" "$pasta/email.env"
  log "$pasta/email.env gravado (600, dono $(id -un))"
}

case "${1:-}" in
  conferir) conferir; log "secrets do e-mail presentes (PROD_SMTP_*)" ;;
  enviar) shift; enviar "$@" ;;
  gravar) gravar ;;
  *) echo "uso: bash email-env.sh conferir | enviar <usuario> | gravar" >&2; exit 2 ;;
esac
