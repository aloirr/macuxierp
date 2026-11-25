/**
 * Superadmin de plataforma pelo operador (T-0050, ADR 0012 §5): cria (ou reconhece) o superadmin pelo e-mail, ou o
 * desativa (revogando as sessões abertas), reativa, destrava ou redefine a senha (T-0077) — numa transação única e
 * auditada no tenant de referência. Quem chama é o operador.sh (ao lado), DENTRO do contêiner `psql` do compose.yml
 * (imagem da API: node 24 e psql 16, sem node_modules), como o admin do DBaaS (PG* do entrypoint), dono das tabelas da
 * 0033 (RLS sem FORCE):
 *
 *   node --input-type=module - --acao <criar|desativar|reativar|destravar|redefinir-senha> --operador <nome> [--confirmar]  < superadmin.mjs
 *
 * Ambiente (nunca no argv): MACUXIERP_SUPERADMIN_EMAIL; só no criar, MACUXIERP_SUPERADMIN_NOME; no criar e no
 * redefinir-senha, só com --confirmar, MACUXIERP_SENHA_INICIAL (gerada no host pelo operador.sh). Sem --confirmar a
 * transação é READ ONLY: só mostra o plano.
 * redefinir-senha (T-0077): grava a senha provisória (argon2id) com deve_trocar_senha, zera falhas e trava e revoga as
 * sessões abertas do portal. Superadmin desativado é recusado (reative antes). Não é idempotente por desenho: cada
 * execução confirmada é uma senha nova, auditada de novo.
 *
 * Mesmo molde do empresa.mjs (SQL fixo pelo stdin do psql, valores por `\getenv`; argon2id da API; erros do psql
 * mascarados): ARGON2, hashSenha e errosSeguros são cópias literais dele, presas pelo
 * apps/api/src/operador-superadmin.db.test.ts. Auditoria: ADR 0012 §5.
 * A auditoria e a saída levam só ids, números e estados; nunca e-mail, nome, senha nem hash.
 *
 * listar (T-0103): não altera superadmin (sem --confirmar e sem e-mail de entrada); grava só a auditoria
 * `plataforma.superadmin.listar` com o operador, a contagem e o `request_id` (O-2, decisão do gerente). Uma linha por
 * superadmin não excluído, com o id, o e-mail MASCARADO pela `plataforma.mascarar_email` da 0035 (o e-mail completo nunca
 * sai do banco), a situação, as falhas, a trava, a troca e a temporária pendentes e o último acesso (Manaus).
 *
 * Última linha = estado que o operador.sh lê: criar → `estado: superadmin-criado` | `estado: superadmin-existia`;
 * demais → `estado: alterado` | `estado: sem-mudanca`; sem --confirmar → `estado: simulacao`; listar → `estado: lista`.
 * Saída 0 = ok; 2 = argumento inválido; 1 = falha (nada gravado: a transação é desfeita).
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

const PADRAO_OPERADOR = /^[a-z][a-z0-9._-]{1,39}$/; // cópia de scripts/plataforma/comum.mjs (o teste operador-superadmin.db.test.ts trava)
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACOES = ['criar', 'desativar', 'reativar', 'destravar', 'redefinir-senha', 'listar'];
const COM_SENHA = new Set(['criar', 'redefinir-senha']); // as ações que gravam a senha provisória do operador.sh
const ARGON2 = { memoria: 19_456, passes: 2, paralelismo: 1, tamanho: 32 }; // ARGON2_PADRAO da API
// Regra única de senha (packages/platform-sdk/src/senha.ts, T-0052): letra, número 0-9 e caractere especial, além do
// tamanho. Cópia (o contêiner não tem node_modules); o teste apps/api/src/operador-senha.test.ts trava contra o SDK.
const SENHA_LETRA = /\p{L}/u;
const SENHA_NUMERO = /[0-9]/;
const SENHA_ESPECIAL = /[^\p{L}0-9\s]/u;
const cumpreRegraSenha = (s) => SENHA_LETRA.test(s) && SENHA_NUMERO.test(s) && SENHA_ESPECIAL.test(s);

class ErroUso extends Error {}

function lerArgumentos(argv, env) {
  const op = { confirmar: false };
  const opcoes = { '--acao': 'acao', '--operador': 'operador' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--confirmar') {
      op.confirmar = true;
      continue;
    }
    const chave = opcoes[argv[i]];
    if (!chave) throw new ErroUso(`opção desconhecida: ${argv[i]}`);
    if (argv[i + 1] === undefined) throw new ErroUso(`${argv[i]} exige um valor`);
    op[chave] = argv[++i];
  }
  op.email = (env.MACUXIERP_SUPERADMIN_EMAIL ?? '').trim().toLowerCase(); // CHECK de plataforma.superadmin.email (0033)
  op.nome = (env.MACUXIERP_SUPERADMIN_NOME ?? '').trim().normalize('NFC');
  op.senha = env.MACUXIERP_SENHA_INICIAL ?? '';
  if (!ACOES.includes(op.acao)) throw new ErroUso(`--acao: ${ACOES.join(', ')}`);
  if (!PADRAO_OPERADOR.test(op.operador ?? '')) throw new ErroUso('--operador exige o nome de quem executa (ex.: alexandre)');
  if (op.acao === 'listar') {
    if (op.confirmar) throw new ErroUso('listar não leva --confirmar');
    if (op.email) throw new ErroUso('MACUXIERP_SUPERADMIN_EMAIL (--email) não vale no listar');
  } else if (op.email.length > 254 || !PADRAO_EMAIL.test(op.email)) {
    throw new ErroUso('MACUXIERP_SUPERADMIN_EMAIL (--email) ausente ou fora do formato');
  }
  if (op.acao === 'criar') {
    const tam = [...op.nome].length; // caracteres (o operador.sh conta igual); CHECK de 2 a 80 na 0033
    if (tam < 2 || tam > 80) throw new ErroUso('MACUXIERP_SUPERADMIN_NOME (--nome): 2 a 80 caracteres');
    if (/\p{Cc}/u.test(op.nome)) throw new ErroUso('MACUXIERP_SUPERADMIN_NOME (--nome): sem quebra de linha nem caractere de controle');
  } else if (op.nome) {
    throw new ErroUso('MACUXIERP_SUPERADMIN_NOME (--nome) só no criar');
  }
  if (COM_SENHA.has(op.acao)) {
    if (op.confirmar && op.senha.length < 16) throw new ErroUso('MACUXIERP_SENHA_INICIAL ausente ou curta (o operador.sh gera 16 caracteres)');
    if (op.confirmar && !cumpreRegraSenha(op.senha)) throw new ErroUso('MACUXIERP_SENHA_INICIAL fora da regra de senha (letra, número e caractere especial)');
    if (!op.confirmar && op.senha) throw new ErroUso('MACUXIERP_SENHA_INICIAL só com --confirmar');
  } else if (op.senha) {
    throw new ErroUso('MACUXIERP_SENHA_INICIAL só no criar e no redefinir-senha (este comando não troca senha)');
  }
  return op;
}

async function hashSenha(senha) {
  if (typeof crypto.argon2 !== 'function') throw new Error('crypto.argon2 indisponível: exige Node >= 24.7 (imagem da API)');
  const sal = crypto.randomBytes(16);
  const h = await promisify(crypto.argon2)('argon2id', {
    message: senha,
    nonce: sal,
    parallelism: ARGON2.paralelismo,
    tagLength: ARGON2.tamanho,
    memory: ARGON2.memoria,
    passes: ARGON2.passes,
  });
  const b64 = (b) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${ARGON2.memoria},t=${ARGON2.passes},p=${ARGON2.paralelismo}$${b64(sal)}$${b64(h)}`;
}

/** Sessões abertas do portal do superadmin `s` (RD-1329): o mesmo filtro na contagem e na revogação do desativar e do
 *  redefinir-senha. Texto fixo do SQL, sem valor. */
const SESSOES_ABERTAS = 'superadmin_id = s.id AND revogada_em IS NULL AND deleted_at IS NULL';

/**
 * SQL fixo (nenhum valor colado), como no empresa.mjs: os valores chegam por `\getenv`, viram GUCs locais (sem eco) e o
 * bloco PL/pgSQL os lê. O resultado volta numa GUC numa linha só: `superadmin|<situacao>|<id ou ->|<detalhe>`.
 */
function montarSql(simular) {
  const vars = ['acao', 'email', 'nome', 'hash', 'operador', 'request_id', 'simular'];
  return `${vars.map((v) => `\\getenv ${v} MACUXIERP_OP_${v.toUpperCase()}`).join('\n')}
BEGIN${simular ? ' READ ONLY' : ''};
\\o /dev/null
SELECT ${vars.map((v) => `set_config('macuxierp_op.${v}', :'${v}', true)`).join(', ')};
\\o
DO $$
DECLARE
  v_acao text := current_setting('macuxierp_op.acao');
  v_email text := current_setting('macuxierp_op.email');
  v_nome text := current_setting('macuxierp_op.nome');
  v_hash text := current_setting('macuxierp_op.hash');
  v_operador text := current_setting('macuxierp_op.operador');
  v_req text := current_setting('macuxierp_op.request_id');
  v_simular boolean := current_setting('macuxierp_op.simular')::boolean;
  v_ref uuid := plataforma.tenant_referencia();
  s record;
  v_id uuid;
  v_abertas integer;
  v_travado boolean;
  v_saida text;
BEGIN
  -- um comando de superadmin por vez no servidor (duas sessões do operador ao mesmo tempo)
  PERFORM pg_advisory_xact_lock(hashtext('macuxierp.operador.superadmin'));
  -- RLS do tenant de referência na transação (o admin é dono das tabelas, sem FORCE; vale também se um dia houver)
  PERFORM set_config('app.tenant_id', v_ref::text, true);

  -- as ações que gravam senha (criar e redefinir-senha) só aceitam o argon2id do hashSenha
  IF NOT v_simular AND v_acao IN ('criar', 'redefinir-senha') AND v_hash NOT LIKE '$argon2id$%' THEN
    RAISE EXCEPTION 'hash da senha fora do formato argon2id' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, ativo, falhas_login, bloqueado_ate, deve_trocar_senha INTO s
  FROM plataforma.superadmin WHERE email = v_email AND deleted_at IS NULL; -- sem FOR UPDATE: a simulação é READ ONLY

  IF v_acao = 'criar' THEN
    IF FOUND THEN
      -- já existe: NADA muda (nem senha, nem nome, nem situação)
      v_saida := format('superadmin|%s|%s|-', CASE WHEN s.ativo THEN 'existia' ELSE 'existia-inativo' END, s.id);
    ELSIF v_simular THEN
      v_saida := 'superadmin|criar|-|-';
    ELSE
      v_id := gen_random_uuid();
      INSERT INTO plataforma.superadmin (id, tenant_id, email, nome, senha_hash, deve_trocar_senha, ativo)
      VALUES (v_id, v_ref, v_email, v_nome, v_hash, true, true);
      INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
      VALUES (v_ref, NULL, 'plataforma.superadmin.criar', 'superadmin', v_id, NULL,
        jsonb_build_object('ativo', true, 'deve_trocar_senha', true, 'operador', v_operador, 'motivo', 'operador.sh'), v_req);
      v_saida := format('superadmin|criado|%s|-', v_id);
    END IF;
  ELSE
    IF NOT FOUND THEN
      RAISE EXCEPTION 'superadmin não encontrado para o e-mail informado; nada foi alterado' USING ERRCODE = 'P0001';
    END IF;
    IF v_acao = 'desativar' THEN
      SELECT count(*) INTO v_abertas FROM plataforma.sessao_superadmin WHERE ${SESSOES_ABERTAS};
      IF NOT s.ativo AND v_abertas = 0 THEN
        v_saida := format('superadmin|ja-desativado|%s|0', s.id);
      ELSIF v_simular THEN
        v_saida := format('superadmin|desativar|%s|%s', s.id, v_abertas);
      ELSE
        UPDATE plataforma.superadmin SET ativo = false WHERE id = s.id;
        UPDATE plataforma.sessao_superadmin SET revogada_em = now() WHERE ${SESSOES_ABERTAS};
        INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
        VALUES (v_ref, NULL, 'plataforma.superadmin.desativar', 'superadmin', s.id, jsonb_build_object('ativo', s.ativo),
          jsonb_build_object('ativo', false, 'sessoes_revogadas', v_abertas, 'operador', v_operador, 'motivo', 'operador.sh'), v_req);
        v_saida := format('superadmin|desativado|%s|%s', s.id, v_abertas);
      END IF;
    ELSIF v_acao = 'reativar' THEN
      IF s.ativo THEN
        v_saida := format('superadmin|ja-ativo|%s|-', s.id);
      ELSIF v_simular THEN
        v_saida := format('superadmin|reativar|%s|-', s.id);
      ELSE
        UPDATE plataforma.superadmin SET ativo = true WHERE id = s.id;
        INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
        VALUES (v_ref, NULL, 'plataforma.superadmin.reativar', 'superadmin', s.id, jsonb_build_object('ativo', false),
          jsonb_build_object('ativo', true, 'operador', v_operador, 'motivo', 'operador.sh'), v_req);
        v_saida := format('superadmin|reativado|%s|-', s.id);
      END IF;
    ELSIF v_acao = 'redefinir-senha' THEN
      IF NOT s.ativo THEN
        RAISE EXCEPTION 'superadmin desativado: reative antes com operador.sh superadmin --reativar; nada foi alterado'
          USING ERRCODE = 'P0001';
      END IF;
      v_travado := s.bloqueado_ate IS NOT NULL;
      SELECT count(*) INTO v_abertas FROM plataforma.sessao_superadmin WHERE ${SESSOES_ABERTAS};
      IF v_simular THEN
        v_saida := format('superadmin|redefinir-senha|%s|%s', s.id,
          v_abertas || ':' || s.falhas_login || CASE WHEN v_travado THEN ':travado' ELSE '' END);
      ELSE
        UPDATE plataforma.superadmin SET senha_hash = v_hash, deve_trocar_senha = true, falhas_login = 0, bloqueado_ate = NULL
        WHERE id = s.id;
        UPDATE plataforma.sessao_superadmin SET revogada_em = now() WHERE ${SESSOES_ABERTAS};
        INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
        VALUES (v_ref, NULL, 'plataforma.superadmin.redefinir_senha', 'superadmin', s.id,
          jsonb_build_object('deve_trocar_senha', s.deve_trocar_senha, 'falhas', s.falhas_login, 'travado', v_travado),
          jsonb_build_object('deve_trocar_senha', true, 'falhas', 0, 'travado', false, 'sessoes_revogadas', v_abertas,
            'operador', v_operador, 'motivo', 'operador.sh'), v_req);
        v_saida := format('superadmin|senha-redefinida|%s|%s', s.id, v_abertas);
      END IF;
    ELSE -- destravar
      v_travado := s.bloqueado_ate IS NOT NULL;
      IF s.falhas_login = 0 AND NOT v_travado THEN
        v_saida := format('superadmin|ja-destravado|%s|-', s.id);
      ELSIF v_simular THEN
        v_saida := format('superadmin|destravar|%s|%s', s.id, s.falhas_login || CASE WHEN v_travado THEN ':travado' ELSE '' END);
      ELSE
        UPDATE plataforma.superadmin SET falhas_login = 0, bloqueado_ate = NULL WHERE id = s.id;
        INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
        VALUES (v_ref, NULL, 'plataforma.superadmin.destravar', 'superadmin', s.id,
          jsonb_build_object('falhas', s.falhas_login, 'travado', v_travado),
          jsonb_build_object('falhas', 0, 'travado', false, 'operador', v_operador, 'motivo', 'operador.sh'), v_req);
        v_saida := format('superadmin|destravado|%s|-', s.id);
      END IF;
    END IF;
  END IF;

  PERFORM set_config('macuxierp_op.saida', v_saida, true);
END $$;
SELECT current_setting('macuxierp_op.saida');
${simular ? 'ROLLBACK' : 'COMMIT'};
`;
}

/** Separador das colunas da lista: US (0x1f), que não aparece em e-mail mascarado, id nem data. */
const SEP = '\u001f';

/**
 * SQL fixo do listar (T-0103), sem valor de entrada. Uma linha por superadmin:
 * `superadmin-lista<US>id<US>email_mascarado<US>ativo<US>troca<US>travado<US>falhas<US>temporaria<US>ultimo_acesso`.
 */
function montarSqlListar() {
  const col = [
    `'superadmin-lista'`,
    's.id::text',
    'plataforma.mascarar_email(s.email)',
    "CASE WHEN s.ativo THEN 'ativo' ELSE 'desativado' END",
    "CASE WHEN s.deve_trocar_senha THEN 'sim' ELSE 'não' END",
    "CASE WHEN s.bloqueado_ate > now() THEN 'sim' ELSE 'não' END",
    's.falhas_login::text',
    "CASE WHEN s.senha_temporaria_expira_em > now() THEN 'sim' ELSE 'não' END",
    "coalesce(to_char(s.ultimo_acesso_em AT TIME ZONE 'America/Manaus', 'DD/MM/YYYY HH24:MI'), 'nunca')",
  ];
  return `\\getenv operador MACUXIERP_OP_OPERADOR
\\getenv request_id MACUXIERP_OP_REQUEST_ID
BEGIN;
\\o /dev/null
SELECT set_config('app.tenant_id', plataforma.tenant_referencia()::text, true);
\\o
SELECT concat_ws('${SEP}', ${col.join(', ')})
FROM plataforma.superadmin s WHERE s.deleted_at IS NULL ORDER BY s.created_at, s.id;
\\o /dev/null
INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
SELECT plataforma.tenant_referencia(), NULL, 'plataforma.superadmin.listar', 'superadmin', NULL, NULL,
  jsonb_build_object('quantidade', count(*), 'operador', :'operador', 'motivo', 'operador.sh'), :'request_id'
FROM plataforma.superadmin WHERE deleted_at IS NULL;
\\o
COMMIT;
`;
}

const CABECALHO_LISTA = ['id', 'e-mail (mascarado)', 'situação', 'troca pendente', 'travado', 'falhas', 'temporária pendente', 'último acesso (Manaus)'];

/** Tabela de texto da lista; só com o que o banco devolveu mascarado. */
function imprimirLista(stdout) {
  const linhas = stdout
    .split('\n')
    .map((l) => l.split(SEP))
    .filter((c) => c.length === CABECALHO_LISTA.length + 1 && c[0] === 'superadmin-lista')
    .map((c) => c.slice(1));
  console.log(`[superadmin] LISTA: ${linhas.length} superadmin(s).`);
  for (const l of linhas) console.log(`  ${CABECALHO_LISTA.map((t, i) => `${t}: ${l[i]}`).join(' · ')}`);
  console.log('estado: lista');
}

/** "1 sessão aberta revogada" / "2 sessões abertas revogadas" (com "seria(m)" na simulação). */
const sessoes = (n, simular) =>
  n === '1' ? `1 sessão aberta ${simular ? 'seria revogada' : 'revogada'}` : `${n} sessões abertas ${simular ? 'seriam revogadas' : 'revogadas'}`;
/** Texto de cada situação. O detalhe: número de sessões no desativar e no senha-redefinida, "falhas[:travado]" no
 *  destravar e "sessões:falhas[:travado]" na simulação do redefinir-senha. */
const TEXTO = {
  existia: () => 'já existia (senha NÃO alterada)',
  'existia-inativo': () => 'já existia, DESATIVADO (senha NÃO alterada; reative com operador.sh superadmin --reativar)',
  criar: () => 'seria criado',
  criado: () => 'criado (deve trocar a senha no 1º acesso)',
  'ja-desativado': () => 'já estava desativado (nenhuma sessão aberta)',
  desativar: (d) => `seria desativado; ${sessoes(d, true)}`,
  desativado: (d) => `desativado; ${sessoes(d, false)}`,
  'ja-ativo': () => 'já estava ativo',
  reativar: () => 'seria reativado',
  reativado: () => 'reativado',
  'ja-destravado': () => 'já estava destravado (0 falhas, sem trava)',
  destravar: (d) => `seria destravado (${d.split(':')[0]} falhas${d.endsWith(':travado') ? ', travado' : ''})`,
  destravado: () => 'destravado (0 falhas, sem trava)',
  'redefinir-senha': (d) => {
    const [abertas, falhas] = d.split(':');
    return `teria a senha redefinida (provisória, troca no 1º acesso; ${falhas} falhas, ${d.endsWith(':travado') ? 'travado' : 'sem trava'}); ${sessoes(abertas, true)}`;
  },
  'senha-redefinida': (d) => `senha redefinida (provisória, troca no 1º acesso; 0 falhas, sem trava); ${sessoes(d, false)}`,
};
const SEM_MUDANCA = new Set(['ja-desativado', 'ja-ativo', 'ja-destravado']);

/** Tira do texto de erro do psql qualquer valor sensível e as linhas de detalhe (DETAIL/CONTEXT/LINE/STATEMENT). */
function errosSeguros(stderr, sensiveis) {
  return stderr
    .split('\n')
    .filter((l) => /ERROR|FATAL|ERRO|could not|não foi possível|psql:/i.test(l) && !/DETAIL|CONTEXT|LINE \d|STATEMENT|HINT/.test(l))
    .map((l) => sensiveis.filter(Boolean).reduce((acc, s) => acc.split(s).join('[omitido]'), l).slice(0, 300))
    .join('\n');
}

async function main(argv, env) {
  let op;
  try {
    op = lerArgumentos(argv, env);
  } catch (e) {
    console.error(`[superadmin] ${e instanceof ErroUso ? e.message : 'argumentos inválidos'}`);
    return 2;
  }
  delete process.env.MACUXIERP_SENHA_INICIAL;
  let hash = '';
  try {
    if (COM_SENHA.has(op.acao) && op.confirmar) hash = await hashSenha(op.senha);
  } catch (e) {
    console.error(`[superadmin] ${e.message}`);
    return 1;
  }
  const filho = { ...env };
  for (const k of ['MACUXIERP_SENHA_INICIAL', 'MACUXIERP_SUPERADMIN_EMAIL', 'MACUXIERP_SUPERADMIN_NOME']) delete filho[k];
  Object.assign(filho, {
    MACUXIERP_OP_ACAO: op.acao,
    MACUXIERP_OP_EMAIL: op.email,
    MACUXIERP_OP_NOME: op.nome,
    MACUXIERP_OP_HASH: hash,
    MACUXIERP_OP_OPERADOR: op.operador,
    MACUXIERP_OP_REQUEST_ID: `operador-${crypto.randomUUID()}`,
    MACUXIERP_OP_SIMULAR: op.confirmar ? 'false' : 'true',
  });
  const listar = op.acao === 'listar';
  const r = spawnSync(env.MACUXIERP_PSQL || 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-At', '-f', '-'], {
    input: listar ? montarSqlListar() : montarSql(!op.confirmar),
    env: filho,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) {
    const msg = r.error ? `psql não executou (${r.error.code ?? r.error.name})` : errosSeguros(r.stderr ?? '', [op.email, op.nome, hash, op.senha]);
    console.error(`[superadmin] falhou; nada foi gravado (transação desfeita).\n${msg}`);
    return 1;
  }
  if (listar) {
    imprimirLista(r.stdout ?? '');
    return 0;
  }
  const item = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.split('|'))
    .find((c) => c.length === 4 && c[0] === 'superadmin' && TEXTO[c[1]]);
  if (!item) {
    console.error('[superadmin] resposta do banco fora do esperado; nada a informar');
    return 1;
  }
  const [, situacao, id, detalhe] = item;
  console.log(op.confirmar ? '[superadmin] APLICADO e auditado (plataforma.auditoria, tenant de referência).' : '[superadmin] SIMULAÇÃO: nada gravado.');
  console.log(`  superadmin: ${TEXTO[situacao](detalhe)}${id !== '-' ? ` (id ${id})` : ''}`);
  const estado = !op.confirmar
    ? 'simulacao'
    : op.acao === 'criar'
      ? situacao === 'criado'
        ? 'superadmin-criado'
        : 'superadmin-existia'
      : SEM_MUDANCA.has(situacao)
        ? 'sem-mudanca'
        : 'alterado';
  console.log(`estado: ${estado}`);
  return 0;
}

// `node - <args>` (stdin) e `node superadmin.mjs <args>` deixam os argumentos a partir do índice 2
process.exitCode = await main(process.argv.slice(2), process.env);
