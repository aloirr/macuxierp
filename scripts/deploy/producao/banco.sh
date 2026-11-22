#!/usr/bin/env bash
# Passo do banco da produção do Macuxi ERP (T-0024, ADR 0003, item 6). IDEMPOTENTE: o implantar.sh roda a cada publicação
# (já com a trava da VM), e o mesmo script serve ao primeiro deploy (banco vazio) e à manutenção à mão na VM:
#
#   bash banco.sh                 (em qualquer pasta; usa /opt/macuxierp, ou MACUXIERP_DIR)
#   bash banco.sh --so-conferir   (SÓ LEITURA: passo 1 e a conferência do banco e dos papéis; não cria nem altera nada.
#                                  É o que o preparar-vm.sh --conferir-banco chama)
#
# Pré-requisitos em /opt/macuxierp (quem grava: env.modelo): .env, gerados.env, banco.env, admin.env e imagens.env (a
# imagem com o psql 16). Tudo roda nos contêineres de ferramenta da imagem da API (psql 16), como o admin do DBaaS
# (sem superusuário), no mesmo servidor do FDV:
#   1. conexão TLS como o admin e privilégios dele (CREATEDB e CREATEROLE obrigatórios);
#   2. banco macuxierp (MACUXIERP_BANCO do .env): criado se falta, conectando ao banco de manutenção
#      (MACUXIERP_BANCO_MANUTENCAO, padrão postgres);
#   3. migrações (db/src/cli/migrar.ts, dono banco-dados; a 0001 cria macuxierp_app, macuxierp_worker e macuxierp_leitura
#      com LOGIN e SEM senha). 3 tentativas;
#   4. senhas dos três papéis (gerados.env): o node calcula o verificador SCRAM-SHA-256 DENTRO do contêiner e o psql aplica
#      o ALTER ROLE; depois cada papel entra uma vez com a própria senha (select current_user);
#   5. conferência: os três com LOGIN, sem SUPERUSER, sem BYPASSRLS, sem CREATEDB e sem CREATEROLE, e nenhum membro de
#      outro em pg_auth_members (o macuxierp_app nunca no macuxierp_worker).
# Qualquer falha sai com código != 0 e nada da aplicação é trocado (o implantar.sh só sobe a versão nova depois).
# Nenhum segredo é impresso: as senhas só existem no gerados.env e no ambiente do contêiner papeis.
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=comum.sh
source "$ORIGEM/comum.sh"

SO_CONFERIR=0
case "${1:-}" in
  '') ;;
  --so-conferir) SO_CONFERIR=1 ;;
  *) echo "[banco] opção desconhecida: $1 (só --so-conferir)" >&2; exit 2 ;;
esac
PASTA="${MACUXIERP_DIR:-/opt/macuxierp}"
log() { echo "[banco] $(date -u +%H:%M:%S) $*"; }
erro() { echo "[banco] ERRO: $2" >&2; exit "$1"; }

cd "$PASTA"
for f in .env gerados.env banco.env admin.env imagens.env; do
  [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (quem grava: env.modelo; o imagens.env vem da 1ª tentativa do implantar.sh)"
done
dcf() { dc --profile ferramentas "$@"; }
psqlc() { dcf run --rm --no-deps -T psql psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -At -F '|' "$@"; }

IDENT='^[a-z_][a-z0-9_]{0,62}$'
BANCO="$(valor_env .env MACUXIERP_BANCO)"
BANCO="${BANCO:-macuxierp}"
MANUT="${MACUXIERP_BANCO_MANUTENCAO:-postgres}"
[[ "$BANCO" =~ $IDENT ]] || erro 2 "MACUXIERP_BANCO inválido no .env (só minúsculas, dígitos e _)"
[[ "$MANUT" =~ $IDENT ]] || erro 2 "MACUXIERP_BANCO_MANUTENCAO inválido"

# ---------- 1. conexão TLS e privilégios do admin ----------
[ -s "$ORIGEM/conexao-admin.sql" ] || erro 2 "$ORIGEM/conexao-admin.sql ausente (o workflow copia scripts/deploy/producao/* junto com este script)"
info=""
for t in 1 2 3; do
  # A consulta fica em conexao-admin.sql (ao lado deste script) e vai pelo stdin: o contêiner não vê o disco do host.
  info="$(psqlc -d "$MANUT" -f - < "$ORIGEM/conexao-admin.sql")" && break
  [ "$t" = 3 ] && erro 3 "sem conexão com o DBaaS como o admin (host, porta, usuário/senha do admin ou TLS; veja a linha do psql acima)"
  log "conexão falhou (tentativa $t); de novo em 10 s"
  sleep 10
done
IFS='|' read -r versao ssl tls super bypass createdb createrole <<< "$info"
[ "$ssl" = t ] || erro 3 "conexão SEM TLS com o DBaaS: recusado (produção só com TLS)"
log "DBaaS: PostgreSQL $versao, TLS $tls ($(grep -q '^MACUXIERP_PG_SSL_LIBPQ=verify-full' imagens.env && echo 'certificado conferido' || echo 'certificado NÃO conferido: sem a CA do DBaaS do FDV'))"
[ "$createdb" = t ] && [ "$createrole" = t ] || erro 2 "o admin precisa de CREATEDB e CREATEROLE (tem createdb=$createdb createrole=$createrole)"
log "admin: superuser=$super bypassrls=$bypass (no DBaaS, os dois são f)"

# ---------- 2. banco ----------
if [ -z "$(psqlc -d "$MANUT" -c "select 1 from pg_database where datname = '$BANCO'")" ]; then
  [ "$SO_CONFERIR" = 1 ] && { log "banco $BANCO ainda não existe: o primeiro implantar.sh cria (nada alterado)"; exit 0; }
  psqlc -d "$MANUT" -c "create database $BANCO" > /dev/null
  log "banco $BANCO criado (primeiro deploy)"
else
  log "banco $BANCO já existe"
fi

if [ "$SO_CONFERIR" = 0 ]; then
# ---------- 3. migrações ----------
for t in 1 2 3; do
  dcf run --rm --no-deps -T migrar && break
  [ "$t" = 3 ] && erro 1 "migrações falharam 3 vezes"
  log "migração falhou (tentativa $t); de novo em 10 s"
  sleep 10
done

# ---------- 4. senhas dos papéis ----------
# O script vai pelo stdin (não é segredo); as senhas vêm do ambiente do contêiner papeis (compose.yml). O psql recebe só
# o verificador SCRAM (sal aleatório, 4096 iterações), nunca a senha em texto.
SENHAS_JS="$(cat <<'JS'
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const papeis = [
  ['macuxierp_app', 'MACUXIERP_SENHA_APP'],
  ['macuxierp_worker', 'MACUXIERP_SENHA_WORKER'],
  ['macuxierp_leitura', 'MACUXIERP_SENHA_LEITURA'],
];
const psql = (args, opcoes) => spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', ...args],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opcoes });
const iteracoes = 4096;
let sql = '';
for (const [papel, nome] of papeis) {
  const senha = process.env[nome] ?? '';
  if (!/^[0-9a-f]{64}$/.test(senha)) {
    console.error(`[papeis] ${nome} ausente ou fora do formato (64 hex, gerado pelo preparar-vm.sh)`);
    process.exit(1);
  }
  const sal = randomBytes(16);
  const salgada = pbkdf2Sync(senha, sal, iteracoes, 32, 'sha256');
  const guardada = createHash('sha256').update(createHmac('sha256', salgada).update('Client Key').digest()).digest();
  const servidor = createHmac('sha256', salgada).update('Server Key').digest();
  sql += `ALTER ROLE ${papel} PASSWORD 'SCRAM-SHA-256$${iteracoes}:${sal.toString('base64')}$${guardada.toString('base64')}:${servidor.toString('base64')}';\n`;
}
const r = psql(['-f', '-'], { input: sql });
if (r.status !== 0) {
  console.error('[papeis] ALTER ROLE ... PASSWORD falhou');
  process.exit(1);
}
// cada papel entra uma vez com a própria senha (confere senha, pg_hba e o CONNECT no banco)
for (const [papel, nome] of papeis) {
  const env = { ...process.env, PGUSER: papel, PGPASSWORD: process.env[nome] };
  const e = psql(['-At', '-c', 'select current_user'], { env });
  if (e.status !== 0 || e.stdout.trim() !== papel) {
    console.error(`[papeis] ${papel} não entrou com a senha do gerados.env`);
    process.exit(1);
  }
}
console.log('[papeis] senhas aplicadas (verificador SCRAM) e login conferido: macuxierp_app, macuxierp_worker, macuxierp_leitura');
JS
)"
printf '%s\n' "$SENHAS_JS" | dcf run --rm --no-deps -T papeis node --input-type=module - \
  || erro 1 "senhas dos papéis não aplicadas (veja a linha [papeis] acima)"
fi # fim do que altera (fora do --so-conferir)

# ---------- 5. conferência dos papéis ----------
papeis="$(psqlc -d "$BANCO" -c "select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
                                   from pg_roles where rolname in ('macuxierp_app', 'macuxierp_leitura', 'macuxierp_worker') order by 1")"
esperado=$'macuxierp_app|t|f|f|f|f\nmacuxierp_leitura|t|f|f|f|f\nmacuxierp_worker|t|f|f|f|f'
if [ "$SO_CONFERIR" = 1 ] && [ -z "$papeis" ]; then
  log "banco $BANCO sem os papéis macuxierp_*: a migração 0001, no próximo implantar.sh, cria (nada alterado)"
  exit 0
fi
[ "$papeis" = "$esperado" ] || erro 1 "papéis da aplicação fora do esperado (LOGIN, sem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE): $(printf '%s' "$papeis" | tr '\n' ' ')"
log "papéis: macuxierp_app, macuxierp_worker e macuxierp_leitura com LOGIN, sem SUPERUSER, BYPASSRLS, CREATEDB e CREATEROLE"
# Nenhum papel da aplicação é membro de outro (pg_auth_members, direto ou por cadeia). Sobretudo: macuxierp_app membro de
# macuxierp_worker herdaria a política worker_global (leitura sem tenant) e furaria o RLS da api (revisão da migração 0027).
membros="$(psqlc -d "$BANCO" -c "with recursive cadeia(membro, papel) as (
                                     select m.member, m.roleid from pg_auth_members m
                                     union
                                     select c.membro, m.roleid from cadeia c join pg_auth_members m on m.member = c.papel)
                                   select a.rolname || ' em ' || b.rolname
                                     from cadeia c join pg_roles a on a.oid = c.membro join pg_roles b on b.oid = c.papel
                                    where a.rolname in ('macuxierp_app', 'macuxierp_leitura', 'macuxierp_worker')
                                      and b.rolname in ('macuxierp_app', 'macuxierp_leitura', 'macuxierp_worker')
                                    order by 1")"
[ -z "$membros" ] || erro 1 "papel da aplicação membro de outro (pg_auth_members; o RLS da api deixaria de valer): $(printf '%s' "$membros" | tr '\n' ';')"
log "pg_auth_members: nenhum papel da aplicação é membro de outro (macuxierp_app fora do macuxierp_worker)"
ultima="$(psqlc -d "$BANCO" -c "select nome from controle.migracao order by nome desc limit 1")"
log "pronto: banco $BANCO, última migração $ultima"
