#!/usr/bin/env bash
# Arquivos de ambiente da produção do Macuxi ERP na VM (T-0024, ADR 0003; deploy automatizado, R-20261122-021030).
# Chamado pelo preparar-vm.sh (como root, a cada publicação). IDEMPOTENTE, nada em log além de nomes e caminhos:
#
#   bash ambiente-vm.sh <usuario-de-deploy>
#
#   1. gerados.env: senhas dos papéis, segredo do JWT e prova do BFF (MACUXIERP_SEGREDO_BFF, T-0050), gerados UMA vez
#      (openssl rand), cada um só se faltar; nunca regenerados;
#   2. .env: criado se faltar; MACUXIERP_CHAVE_A1 e MACUXIERP_CHAVE_INTEGRACAO geradas (openssl rand -hex 32) SÓ se
#      faltarem ou estiverem vazias. Valor presente NUNCA é trocado (perder a chave do A1 é irreversível);
#   3. banco.env, admin.env e segredos.env: copiados a cada publicação da configuração de produção do FDV, na mesma VM
#      (/opt/macuxi/{banco,admin,segredos}.env), SÓ com as variáveis de nome conhecido; a CA do DBaaS
#      (/opt/macuxi/certs/dbaas-ca.pem, opcional) vai para certs/ com 644. /opt/macuxi é SÓ LIDO (ADR 0003, item 3);
#   4. todos os *.env da pasta: dono o usuário de deploy, modo 600.
# email.env não é gravado aqui: vem dos secrets PROD_SMTP_* pelo producao-publicar.yml (email-env.sh, T-0076), logo depois
# deste script; o passo 4 o deixa 600 nas publicações seguintes. alerta.env não é gravado (webhook desligado; o
# alerta-saude.sh aceita a falta). Lista dos arquivos e das variáveis: env.modelo.
# MACUXIERP_DIR e MACUXI_FDV_DIR trocam as pastas SÓ para teste (o sudo do workflow não os repassa).
set -euo pipefail
set +x
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"
PASTA="${MACUXIERP_DIR:-/opt/macuxierp}"
FDV="${MACUXI_FDV_DIR:-/opt/macuxi}"
log() { echo "[ambiente-vm] $*"; }
erro() { echo "[ambiente-vm] $*" >&2; exit 1; }

USUARIO="${1:-}"
[ -n "$USUARIO" ] && id "$USUARIO" >/dev/null 2>&1 || erro "usuário de deploy '${USUARIO}' não existe (bash ambiente-vm.sh <usuario>)"
[ -d "$PASTA" ] || erro "$PASTA ausente: o preparar-vm.sh cria antes"
command -v openssl >/dev/null 2>&1 || erro "openssl ausente"
umask 077

dono_600() { chown "$USUARIO:$USUARIO" "$1"; chmod 600 "$1"; }

# ---------- 1. gerados.env ----------
GERADOS="$PASTA/gerados.env"
[ -f "$GERADOS" ] || : > "$GERADOS"
acrescentar() { # nome valor: só se a variável ainda não existir (nunca regenera)
  grep -q "^$1=" "$GERADOS" || { printf '%s=%s\n' "$1" "$2" >> "$GERADOS"; log "gerado $1 (gerados.env)"; }
}
acrescentar MACUXIERP_SENHA_APP "$(openssl rand -hex 32)"
acrescentar MACUXIERP_SENHA_WORKER "$(openssl rand -hex 32)"
acrescentar MACUXIERP_SENHA_LEITURA "$(openssl rand -hex 32)"
acrescentar MACUXIERP_JWT_SEGREDO "$(openssl rand -hex 48)"
acrescentar MACUXIERP_SEGREDO_BFF "$(openssl rand -hex 32)"
dono_600 "$GERADOS"

# ---------- 2. .env: chaves mestras ----------
ENVF="$PASTA/.env"
if [ ! -f "$ENVF" ]; then
  printf '# Gerado pelo preparar-vm.sh (ambiente-vm.sh) do Macuxi ERP. Lista das variáveis: env.modelo.\n' > "$ENVF"
  log "criado $ENVF"
fi
dono_600 "$ENVF"
chave_se_faltar() { # nome: gera só se ausente ou vazia; presente (válida ou não) nunca é tocada
  local nome="$1"
  [ -n "$(valor_env "$ENVF" "$nome")" ] && return 0
  # linhas "NOME=" vazias saem (senão o compose leria a vazia ou a duplicada); valor presente nunca chega aqui
  grep -vE "^$nome=[\"' "$'\r'"]*$" "$ENVF" > "$ENVF.tmp" || :
  [ -n "$(valor_env "$ENVF.tmp" "$nome")" ] && { rm -f "$ENVF.tmp"; return 0; }
  printf '%s=%s\n' "$nome" "$(openssl rand -hex 32)" >> "$ENVF.tmp"
  dono_600 "$ENVF.tmp"
  mv -f "$ENVF.tmp" "$ENVF"
  log "gerado $nome (.env)"
}
chave_se_faltar MACUXIERP_CHAVE_A1
chave_se_faltar MACUXIERP_CHAVE_INTEGRACAO

# ---------- 3. configuração de produção do FDV (só leitura em $FDV) ----------
copiar_do_fdv() { # arquivo "NOME1|NOME2" "obrigatórios separados por espaço"
  local arq="$1" nomes="$2" obrig="$3" origem="$FDV/$1" destino="$PASTA/$1" n
  [ -f "$origem" ] || erro "$origem ausente (configuração de produção do FDV nesta VM): nada foi publicado"
  [ -r "$origem" ] || erro "$origem sem permissão de leitura: nada foi publicado"
  grep -E "^($nomes)=" "$origem" | tr -d '\r' > "$destino.tmp" || :
  for n in $obrig; do
    [ -n "$(valor_env "$destino.tmp" "$n")" ] || { rm -f "$destino.tmp"; erro "$origem sem $n: nada foi publicado"; }
  done
  dono_600 "$destino.tmp"
  mv -f "$destino.tmp" "$destino"
  log "$arq copiado de $origem"
}
copiar_do_fdv banco.env 'MACUXI_PG_HOST|MACUXI_PG_PORTA' 'MACUXI_PG_HOST'
porta="$(valor_env "$PASTA/banco.env" MACUXI_PG_PORTA)"
[ -z "$porta" ] || [[ "$porta" =~ ^[0-9]{1,5}$ ]] || erro "$FDV/banco.env com MACUXI_PG_PORTA fora do formato (só dígitos)"
copiar_do_fdv admin.env 'MACUXI_PG_ADMIN_USUARIO|MACUXI_PG_ADMIN_SENHA' 'MACUXI_PG_ADMIN_USUARIO MACUXI_PG_ADMIN_SENHA'
[[ "$(valor_env "$PASTA/admin.env" MACUXI_PG_ADMIN_USUARIO)" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] \
  || erro "$FDV/admin.env com MACUXI_PG_ADMIN_USUARIO fora do formato (identificador do PostgreSQL)"
# S3: o código do ERP ainda não lê (env.modelo); o arquivo do FDV é exigido, as variáveis não
copiar_do_fdv segredos.env 'MACUXI_S3_CHAVE_ID|MACUXI_S3_SEGREDO' ''

# CA do DBaaS: pública (644), opcional como no FDV; sem ela o implantar.sh usa TLS sem conferir o certificado
install -d -m 755 -o "$USUARIO" -g "$USUARIO" "$PASTA/certs"
if [ -s "$FDV/certs/dbaas-ca.pem" ]; then
  if ! cmp -s "$FDV/certs/dbaas-ca.pem" "$PASTA/certs/dbaas-ca.pem"; then
    install -m 644 -o "$USUARIO" -g "$USUARIO" "$FDV/certs/dbaas-ca.pem" "$PASTA/certs/dbaas-ca.pem"
    log "CA do DBaaS copiada de $FDV/certs/dbaas-ca.pem (TLS verify-full)"
  else
    chown "$USUARIO:$USUARIO" "$PASTA/certs/dbaas-ca.pem"; chmod 644 "$PASTA/certs/dbaas-ca.pem"
  fi
else
  rm -f "$PASTA/certs/dbaas-ca.pem"
  echo "::warning::$FDV/certs/dbaas-ca.pem ausente: TLS com o DBaaS sem conferir o certificado"
fi

# ---------- 4. demais *.env (imagens.env...): dono o usuário de deploy, 600 ----------
for f in "$PASTA"/.env "$PASTA"/*.env; do
  if [ -f "$f" ]; then dono_600 "$f"; fi
done
log "pronto: arquivos de ambiente de $PASTA (600, dono $USUARIO)"
