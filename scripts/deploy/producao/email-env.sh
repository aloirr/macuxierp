#!/usr/bin/env bash
# email.env da produção do Macuxi ERP (T-0076): monta, NO RUNNER, o arquivo com o SMTP a partir dos 6 secrets do
# environment PRODUCAO (os mesmos nomes do FDV). Chamado pelo producao-publicar.yml; o arquivo vai à VM pelo stdin do
# ssh e o ambiente-vm.sh o instala em /opt/macuxierp/email.env (600), lido só pela api e pelo worker (x-app do compose.yml).
#
#   PROD_SMTP_HOST=... PROD_SMTP_PORTA=... PROD_SMTP_TLS=... PROD_SMTP_USUARIO=... PROD_SMTP_SENHA=... \
#   PROD_SMTP_REMETENTE=... bash email-env.sh <arquivo-de-saida>
#
# Regras (as do FDV): sem PROD_SMTP_HOST o e-mail fica desligado; com ele, USUARIO e SENHA são obrigatórios; TLS é
# starttls ou tls; PORTA só dígitos. Qualquer falta ou valor fora do formato DESLIGA o e-mail (MACUXI_EMAIL_TRANSPORTE=
# desligado, sem nenhum MACUXI_SMTP_*) com aviso; o job NÃO falha. Valores entre aspas simples (sem interpolação do
# Compose); valor com aspa simples, quebra de linha ou caractere de controle é recusado.
# No resumo do job ($GITHUB_STEP_SUMMARY) e no log saem SÓ os NOMES dos secrets, nunca os valores. Sem set -x; os
# valores só passam por variável e pelo printf (builtin do bash), nunca pelo argv de um processo.
set -euo pipefail
set +x
SAIDA="${1:?uso: bash email-env.sh <arquivo-de-saida>}"
RESUMO="${GITHUB_STEP_SUMMARY:-/dev/null}"
NOMES=(PROD_SMTP_HOST PROD_SMTP_PORTA PROD_SMTP_TLS PROD_SMTP_USUARIO PROD_SMTP_SENHA PROD_SMTP_REMETENTE)

declare -A V
falta=()
for n in "${NOMES[@]}"; do
  v="${!n:-}"
  v="${v//$'\r'/}"
  # tira só as quebras de linha do fim (colado pelo celular); quebra no meio continua e é recusada abaixo
  while [[ "$v" == *$'\n' ]]; do v="${v%$'\n'}"; done
  V[$n]="$v"
  [ -n "$v" ] || falta+=("$n")
done

# usuário e senha nunca aparecem no log, mesmo fora de um secret mascarado
for n in PROD_SMTP_USUARIO PROD_SMTP_SENHA; do
  v="${V[$n]}"
  if [ -n "$v" ] && [[ "$v" != *$'\n'* ]]; then echo "::add-mask::$v"; fi
done

problemas=()
if [ -n "${V[PROD_SMTP_HOST]}" ]; then
  for n in PROD_SMTP_USUARIO PROD_SMTP_SENHA; do
    [ -n "${V[$n]}" ] || problemas+=("$n ausente (obrigatório com PROD_SMTP_HOST)")
  done
  for n in "${NOMES[@]}"; do
    v="${V[$n]}"
    if [[ "$v" =~ [[:cntrl:]] ]]; then problemas+=("$n com quebra de linha ou caractere de controle"); continue; fi
    case "$v" in *"'"*) problemas+=("$n com aspa simples (não cabe no email.env)");; esac
  done
  p="${V[PROD_SMTP_PORTA]}"
  [ -z "$p" ] || { [[ "$p" =~ ^[0-9]{1,5}$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } \
    || problemas+=("PROD_SMTP_PORTA fora do formato (só dígitos, 1 a 65535)")
  case "${V[PROD_SMTP_TLS]}" in '' | starttls | tls) ;; *) problemas+=("PROD_SMTP_TLS fora do formato (starttls ou tls)");; esac
fi

if [ -n "${V[PROD_SMTP_HOST]}" ] && [ ${#problemas[@]} -eq 0 ]; then
  transporte=smtp
else
  transporte=desligado
fi

(
  umask 077
  {
    printf '# Gerado pelo producao-publicar.yml (scripts/deploy/producao/email-env.sh). Lista das variáveis: env.modelo.\n'
    printf 'MACUXI_EMAIL_TRANSPORTE=%s\n' "$transporte"
    if [ "$transporte" = smtp ]; then
      for n in "${NOMES[@]}"; do
        printf "MACUXI_SMTP_%s='%s'\n" "${n#PROD_SMTP_}" "${V[$n]}"
      done
    fi
  } > "$SAIDA"
)
chmod 600 "$SAIDA"

{
  echo "### E-mail (SMTP) da produção"
  echo
  echo "MACUXI_EMAIL_TRANSPORTE=\`$transporte\` (/opt/macuxierp/email.env, só macuxierp-api e macuxierp-worker)."
  echo
  if [ ${#falta[@]} -eq 0 ]; then
    echo "Os 6 secrets PROD_SMTP_* estão no environment PRODUCAO."
  else
    echo "Secrets ausentes no environment PRODUCAO (só os nomes): ${falta[*]}."
  fi
  for x in "${problemas[@]}"; do echo "- $x"; done
} >> "$RESUMO"

[ ${#falta[@]} -eq 0 ] || echo "secrets do SMTP ausentes (só os nomes): ${falta[*]}"
if [ -z "${V[PROD_SMTP_HOST]}" ]; then
  echo "::notice::e-mail desligado: sem PROD_SMTP_HOST no environment PRODUCAO"
elif [ ${#problemas[@]} -gt 0 ]; then
  for x in "${problemas[@]}"; do echo "::warning::e-mail desligado: $x"; done
else
  echo "e-mail ligado (MACUXI_EMAIL_TRANSPORTE=smtp)"
fi
