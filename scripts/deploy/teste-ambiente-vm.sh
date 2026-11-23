#!/usr/bin/env bash
# Teste local do scripts/deploy/producao/ambiente-vm.sh (T-0024, deploy automatizado): simula /opt/macuxi (FDV) e
# /opt/macuxierp numa pasta temporária, roda duas vezes e confere que a 2ª não regera chaves, que os modos são 600 (CA 644),
# que só as variáveis conhecidas do FDV são copiadas, que nada é gravado na pasta do FDV e que a falta de um arquivo do FDV
# falha citando o caminho. Precisa de root (chown). Uso: sudo bash scripts/deploy/teste-ambiente-vm.sh [usuario, com grupo de mesmo nome; padrão root]
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/producao/ambiente-vm.sh"
USUARIO="${1:-root}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
FDV="$T/macuxi"; ERP="$T/macuxierp"
mkdir -p "$FDV/certs" "$ERP"
printf 'MACUXI_PG_HOST=db.exemplo\nMACUXI_PG_PORTA=25060\nMACUXI_OUTRA=nao-copiar\n' > "$FDV/banco.env"
printf 'MACUXI_PG_ADMIN_USUARIO=doadmin\r\nMACUXI_PG_ADMIN_SENHA=falsa\nMACUXI_RECADOS_TOKEN=nao-copiar\n' > "$FDV/admin.env"
printf 'MACUXI_S3_CHAVE_ID=id-falso\nMACUXI_S3_SEGREDO=segredo-falso\nMACUXI_FCM=nao-copiar\n' > "$FDV/segredos.env"
printf -- '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----\n' > "$FDV/certs/dbaas-ca.pem"
# .env antigo com a chave do Conector vazia e outra variável que não pode mudar
printf 'MACUXIERP_BANCO=macuxierp\nMACUXIERP_CHAVE_INTEGRACAO=\n' > "$ERP/.env"
chmod 644 "$ERP/.env"
antes_fdv="$(cd "$FDV" && find . -type f -exec sha256sum {} + | sort; stat -c '%n %a' ./*.env)"

falhou=0
ok() { echo "ok   $*"; }
nao() { echo "FALHA $*"; falhou=1; }
roda() { MACUXIERP_DIR="$ERP" MACUXI_FDV_DIR="$FDV" bash "$SCRIPT" "$USUARIO"; }
# shellcheck source-path=SCRIPTDIR source=producao/comum.sh
source "$(dirname "$SCRIPT")/comum.sh"

roda > "$T/saida1"
a1="$(valor_env "$ERP/.env" MACUXIERP_CHAVE_A1)"; int="$(valor_env "$ERP/.env" MACUXIERP_CHAVE_INTEGRACAO)"; jwt="$(valor_env "$ERP/gerados.env" MACUXIERP_JWT_SEGREDO)"
bff="$(valor_env "$ERP/gerados.env" MACUXIERP_SEGREDO_BFF)"
[[ "$bff" =~ ^[0-9a-f]{64}$ ]] && ok "1ª: MACUXIERP_SEGREDO_BFF gerado (64 hex, T-0050)" || nao "1ª: MACUXIERP_SEGREDO_BFF"
[[ "$a1" =~ ^[0-9a-f]{64}$ ]] && ok "1ª: MACUXIERP_CHAVE_A1 gerada (64 hex)" || nao "1ª: MACUXIERP_CHAVE_A1"
[[ "$int" =~ ^[0-9a-f]{64}$ ]] && ok "1ª: MACUXIERP_CHAVE_INTEGRACAO gerada no lugar da vazia" || nao "1ª: MACUXIERP_CHAVE_INTEGRACAO"
[ "$(grep -c '^MACUXIERP_CHAVE_INTEGRACAO=' "$ERP/.env")" = 1 ] && ok "1ª: uma linha só da chave do Conector" || nao "linha duplicada"
[ "$(valor_env "$ERP/.env" MACUXIERP_BANCO)" = macuxierp ] && ok "1ª: MACUXIERP_BANCO preservado" || nao "MACUXIERP_BANCO"
[ "$(cat "$ERP/banco.env")" = $'MACUXI_PG_HOST=db.exemplo\nMACUXI_PG_PORTA=25060' ] && ok "banco.env só com os nomes do ERP" || nao "banco.env"
[ "$(cat "$ERP/admin.env")" = $'MACUXI_PG_ADMIN_USUARIO=doadmin\nMACUXI_PG_ADMIN_SENHA=falsa' ] && ok "admin.env só com os nomes do ERP (sem \\r)" || nao "admin.env"
[ "$(cat "$ERP/segredos.env")" = $'MACUXI_S3_CHAVE_ID=id-falso\nMACUXI_S3_SEGREDO=segredo-falso' ] && ok "segredos.env só com os nomes do ERP" || nao "segredos.env"
if grep -q "$a1\|$int\|$bff\|$jwt\|falsa\|segredo-falso" "$T/saida1"; then nao "valor de segredo na saída"; else ok "nenhum valor na saída"; fi

roda > "$T/saida2"
[ "$(valor_env "$ERP/.env" MACUXIERP_CHAVE_A1)" = "$a1" ] && ok "2ª: MACUXIERP_CHAVE_A1 igual (não regerada)" || nao "2ª: A1 regerada"
[ "$(valor_env "$ERP/.env" MACUXIERP_CHAVE_INTEGRACAO)" = "$int" ] && ok "2ª: MACUXIERP_CHAVE_INTEGRACAO igual" || nao "2ª: integração regerada"
[ "$(valor_env "$ERP/gerados.env" MACUXIERP_JWT_SEGREDO)" = "$jwt" ] && ok "2ª: gerados.env igual" || nao "2ª: gerados regerado"
[ "$(valor_env "$ERP/gerados.env" MACUXIERP_SEGREDO_BFF)" = "$bff" ] && [ "$(grep -c '^MACUXIERP_SEGREDO_BFF=' "$ERP/gerados.env")" = 1 ] && ok "2ª: MACUXIERP_SEGREDO_BFF igual, uma linha só" || nao "2ª: prova do BFF regerada ou duplicada"
grep -q 'gerado' "$T/saida2" && nao "2ª: gerou algo" || ok "2ª: nada gerado"
for f in .env gerados.env banco.env admin.env segredos.env; do
  m="$(stat -c '%a %U' "$ERP/$f")"; [ "$m" = "600 $USUARIO" ] && ok "$f: $m" || nao "$f: $m"
done
m="$(stat -c '%a %U' "$ERP/certs/dbaas-ca.pem")"; [ "$m" = "644 $USUARIO" ] && ok "certs/dbaas-ca.pem: $m" || nao "CA: $m"
[ -e "$ERP/email.env" ] || [ -e "$ERP/alerta.env" ] && nao "email.env/alerta.env criados" || ok "email.env e alerta.env não criados"
ls "$ERP"/*.tmp >/dev/null 2>&1 && nao "sobrou .tmp" || ok "sem .tmp"
depois_fdv="$(cd "$FDV" && find . -type f -exec sha256sum {} + | sort; stat -c '%n %a' ./*.env)"
[ "$antes_fdv" = "$depois_fdv" ] && [ "$(find "$FDV" -type f | wc -l)" = 4 ] && ok "pasta do FDV intacta" || nao "pasta do FDV mudou"

# instalação anterior à T-0050: gerados.env sem MACUXIERP_SEGREDO_BFF ganha a prova; as senhas e o JWT ficam iguais
grep -v '^MACUXIERP_SEGREDO_BFF=' "$ERP/gerados.env" > "$T/gerados-antigo"; cp "$T/gerados-antigo" "$ERP/gerados.env"
roda > "$T/saida3"
novo_bff="$(valor_env "$ERP/gerados.env" MACUXIERP_SEGREDO_BFF)"
[[ "$novo_bff" =~ ^[0-9a-f]{64}$ ]] && [ "$(grep -v '^MACUXIERP_SEGREDO_BFF=' "$ERP/gerados.env")" = "$(cat "$T/gerados-antigo")" ] && ok "gerados.env antigo: prova do BFF acrescentada, o resto igual" || nao "gerados.env antigo"
grep -q "$novo_bff" "$T/saida3" && nao "prova do BFF na saída" || ok "prova do BFF fora da saída"

# chave do A1 já existente e válida, em base64: nunca trocada
printf 'MACUXIERP_CHAVE_A1=%s\n' "$(openssl rand -base64 32)" > "$ERP/.env"; b64="$(valor_env "$ERP/.env" MACUXIERP_CHAVE_A1)"
roda > /dev/null
[ "$(valor_env "$ERP/.env" MACUXIERP_CHAVE_A1)" = "$b64" ] && ok "A1 em base64 existente preservada" || nao "A1 base64 trocada"

# arquivo do FDV ausente: falha citando só o caminho; CA ausente: aviso e cópia removida
rm "$FDV/certs/dbaas-ca.pem"; roda > /dev/null; [ -e "$ERP/certs/dbaas-ca.pem" ] && nao "CA velha ficou" || ok "sem CA no FDV: cópia removida"
rm "$FDV/admin.env"
if roda > "$T/saida3" 2>&1; then nao "admin.env ausente não falhou"; else grep -q "$FDV/admin.env ausente" "$T/saida3" && ok "admin.env do FDV ausente: falha citando o caminho" || nao "mensagem"; fi
printf 'MACUXI_PG_ADMIN_USUARIO=doadmin\n' > "$FDV/admin.env"
if roda > "$T/saida4" 2>&1; then nao "admin sem senha não falhou"; else grep -q "sem MACUXI_PG_ADMIN_SENHA" "$T/saida4" && ok "admin.env sem a senha: falha" || nao "mensagem 4"; fi

[ "$falhou" = 0 ] && echo "TUDO OK" || { echo "HOUVE FALHA"; exit 1; }
