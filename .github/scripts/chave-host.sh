#!/usr/bin/env bash
# Chave do host de produção, comum ao producao-publicar.yml e ao producao-diagnostico.yml (v0.3.31; RD-a).
#
# Decisão do PO (opção c, 28/11): nada de known_hosts versionado; fica fixada só a IMPRESSÃO DIGITAL da ED25519 da VM
# (ESPERADA, abaixo, o único lugar do repositório com o valor). A cada execução o workflow traz a chave do secret
# PROD_SSH_KNOWN_HOSTS (se existir) ou do ssh-keyscan e passa por aqui ANTES de qualquer ssh/scp à VM:
#   - linhas de outro tipo, marcadores @ e comentários saem; cada ssh-ed25519 vira "macuxierp-prod ssh-ed25519 <base64>"
#     (o ~/.ssh/config do "Host prod" usa HostKeyAlias macuxierp-prod: o ssh procura a chave pelo alias, nunca pelo host);
#   - o ssh-keygen -lf roda sobre essas MESMAS linhas, que são as que vão para o known_hosts;
#   - sai 1 com ::error:: e SEM gravar o known_hosts se não vier nenhuma ed25519, se vierem duas ou mais impressões
#     digitais distintas ou se a única não for a ESPERADA.
#
# Uso: bash .github/scripts/chave-host.sh <entrada> <fonte> <known_hosts>
#   entrada      arquivo com o secret ou a saída do ssh-keyscan
#   fonte        rótulo para o log e o resumo do job
#   known_hosts  destino (gravado só quando a impressão digital bate)
# Este script não recebe nem lê o host (PROD_HOST); log e resumo levam só a fonte, a chave pública e a impressão digital.
set -euo pipefail

ALIAS='macuxierp-prod'
# ED25519 da VM de produção, conferida pelo Alexandre na VM (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub).
ESPERADA='SHA256:wRktlR17SPnfY7hK7u1/4XhMJ1qeON3xyFzF+b9Gy0s'

[ $# -eq 3 ] || { echo "uso: $0 <entrada> <fonte> <known_hosts>" >&2; exit 2; }
entrada="$1" fonte="$2" destino="$3"
resumo="${GITHUB_STEP_SUMMARY:-/dev/null}"

falhar() {
  echo "::error::chave do host ($fonte): $1"
  {
    echo "### Chave do host de produção ($fonte)"
    echo
    echo "**$1: passo interrompido antes de qualquer comando na VM.**"
  } >> "$resumo"
  exit 1
}

linhas="$(mktemp)"
trap 'rm -f "$linhas"' EXIT
tr -d '\r' < "$entrada" | awk -v a="$ALIAS" '
  /^[[:space:]]*(#|$)/ { next }
  $1 ~ /^@/ { next }
  $2 == "ssh-ed25519" && $3 ~ /^[A-Za-z0-9+\/]+=*$/ { if (!visto[$3]++) print a, $2, $3 }
' > "$linhas"
[ -s "$linhas" ] || falhar "nenhuma chave ssh-ed25519"

digitais="$(ssh-keygen -lf "$linhas" 2>/dev/null | awk '{print $2}' | sort -u)" || falhar "chave ssh-ed25519 ilegível"
[ -n "$digitais" ] || falhar "chave ssh-ed25519 ilegível"
[ "$(printf '%s\n' "$digitais" | wc -l)" -eq 1 ] || falhar "duas ou mais chaves ssh-ed25519 distintas"
[ "$digitais" = "$ESPERADA" ] || falhar "impressão digital $digitais não é a conferida na VM (ED25519 $ESPERADA)"

cp "$linhas" "$destino"
chmod 600 "$destino"
echo "chave do host ($fonte): ssh-ed25519 $digitais, a conferida na VM"
{
  echo "### Chave do host de produção ($fonte)"
  echo
  echo "Chave pública \`ssh-ed25519 $(awk '{print $3}' "$linhas")\`, impressão digital \`$digitais\`: a conferida na VM."
} >> "$resumo"
