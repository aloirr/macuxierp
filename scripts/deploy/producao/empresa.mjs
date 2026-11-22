/**
 * Primeiro acesso de uma empresa na produção (T-0024): cria (ou reconhece) o tenant pelo slug, o 1º administrador pelo
 * e-mail e as licenças core, cadastros, pedido e integracao-fdv, com auditoria — numa transação única e idempotente.
 * Quem chama é o operador.sh (ao lado), DENTRO do contêiner `psql` do compose.yml (imagem da API: node 24 e psql 16,
 * sem node_modules), como o admin do DBaaS (PG* do entrypoint):
 *
 *   node --input-type=module - --slug <slug> --operador <nome> [--confirmar]  < empresa.mjs
 *
 * Ambiente (nunca no argv): MACUXIERP_EMPRESA_NOME (nome legal da empresa: de MEI pode ser dado pessoal),
 * MACUXIERP_ADMIN_EMAIL, MACUXIERP_ADMIN_NOME e, só com --confirmar, MACUXIERP_SENHA_INICIAL (gerada no host pelo
 * operador.sh). Sem --confirmar a transação é READ ONLY: só mostra o plano.
 *
 * Só módulos nativos do Node. O banco é o `psql` do contêiner, com o SQL pelo stdin e os valores pelo ambiente do psql
 * (`\getenv` + `:'var'`, citação do próprio psql): nada de valor colado no SQL nem no argv. O argon2id é o mesmo da API
 * (apps/api/src/auth/senha.ts: PHC, 19 MiB, t=2, p=1); o teste apps/api/src/operador-empresa.db.test.ts entra pela
 * rota de login real com a senha.
 *
 * Saída: só slug, ids e o que foi criado ou já existia; nunca nome da empresa, e-mail, nome da pessoa, senha nem hash
 * (nem nos erros do psql). A auditoria guarda o slug, nunca o nome da empresa. A última linha é o
 * estado que o operador.sh lê: `estado: usuario-criado`, `estado: usuario-existia` ou `estado: simulacao`.
 * Saída 0 = ok; 2 = argumento inválido; 1 = falha (nada gravado: a transação é desfeita).
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

const PADRAO_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/; // CHECK de plataforma.tenant.slug (0002)
const PADRAO_OPERADOR = /^[a-z][a-z0-9._-]{1,39}$/; // cópia de scripts/plataforma/comum.mjs (o teste operador-empresa.db.test.ts trava)
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// cópia de MODULOS do SDK; o teste operador-empresa.db.test.ts trava
const MODULOS_LIGAR = ['core', 'cadastros', 'pedido', 'integracao-fdv'];
const MODULOS_INFORMAR = ['faturamento', 'fiscal'];
const ARGON2 = { memoria: 19_456, passes: 2, paralelismo: 1, tamanho: 32 }; // ARGON2_PADRAO da API

class ErroUso extends Error {}

function lerArgumentos(argv, env) {
  const op = { confirmar: false };
  const opcoes = { '--slug': 'slug', '--operador': 'operador' };
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
  op.nome = (env.MACUXIERP_EMPRESA_NOME ?? '').trim().normalize('NFC');
  op.email = (env.MACUXIERP_ADMIN_EMAIL ?? '').trim().toLowerCase(); // mesma normalização da API (auth/servico.ts)
  op.adminNome = (env.MACUXIERP_ADMIN_NOME ?? '').trim();
  op.senha = env.MACUXIERP_SENHA_INICIAL ?? '';
  if (!PADRAO_SLUG.test(op.slug ?? '')) throw new ErroUso('--slug: minúsculas, dígitos e hífen, 2 a 40 caracteres');
  const tamNome = [...op.nome].length; // caracteres, não unidades UTF-16 (o operador.sh conta igual)
  if (tamNome < 2 || tamNome > 120) throw new ErroUso('MACUXIERP_EMPRESA_NOME (--nome): 2 a 120 caracteres');
  if (/\p{Cc}/u.test(op.nome)) throw new ErroUso('MACUXIERP_EMPRESA_NOME (--nome): sem quebra de linha nem caractere de controle');
  if (!PADRAO_OPERADOR.test(op.operador ?? '')) throw new ErroUso('--operador exige o nome de quem executa (ex.: alexandre)');
  if (op.email.length > 254 || !PADRAO_EMAIL.test(op.email)) throw new ErroUso('MACUXIERP_ADMIN_EMAIL ausente ou fora do formato');
  if (op.adminNome.length < 2 || op.adminNome.length > 80) throw new ErroUso('MACUXIERP_ADMIN_NOME: 2 a 80 caracteres');
  if (op.confirmar && op.senha.length < 16) throw new ErroUso('MACUXIERP_SENHA_INICIAL ausente ou curta (o operador.sh gera 16 caracteres)');
  if (!op.confirmar && op.senha) throw new ErroUso('MACUXIERP_SENHA_INICIAL só com --confirmar');
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

/**
 * SQL fixo (nenhum valor colado): os valores chegam pelo ambiente do psql (`\getenv`), viram GUCs locais da transação
 * (sem eco: `\o /dev/null`) e o bloco PL/pgSQL os lê. O resultado volta numa GUC (`macuxierp_op.saida`), uma linha por
 * item: `tipo|chave|situacao|id`.
 */
function montarSql(simular) {
  const vars = ['slug', 'nome', 'email', 'admin_nome', 'hash', 'operador', 'request_id', 'simular', 'modulos'];
  return `${vars.map((v) => `\\getenv ${v} MACUXIERP_OP_${v.toUpperCase()}`).join('\n')}
BEGIN${simular ? ' READ ONLY' : ''};
\\o /dev/null
SELECT ${vars.map((v) => `set_config('macuxierp_op.${v}', :'${v}', true)`).join(', ')};
\\o
DO $$
DECLARE
  v_slug text := current_setting('macuxierp_op.slug');
  v_nome text := current_setting('macuxierp_op.nome');
  v_email text := current_setting('macuxierp_op.email');
  v_admin_nome text := current_setting('macuxierp_op.admin_nome');
  v_hash text := current_setting('macuxierp_op.hash');
  v_operador text := current_setting('macuxierp_op.operador');
  v_req text := current_setting('macuxierp_op.request_id');
  v_simular boolean := current_setting('macuxierp_op.simular')::boolean;
  v_modulos text[] := string_to_array(current_setting('macuxierp_op.modulos'), ',');
  t record;
  u record;
  l record;
  m text;
  v_tenant uuid;
  v_usuario uuid;
  v_lic uuid;
  v_existia boolean;
  saida text[] := '{}';
BEGIN
  -- uma criação de empresa por vez no servidor (duas sessões do operador ao mesmo tempo)
  PERFORM pg_advisory_xact_lock(hashtext('macuxierp.operador.criar-empresa'));

  SELECT id, situacao, deleted_at INTO t FROM plataforma.tenant WHERE slug = v_slug;
  IF FOUND THEN
    IF t.deleted_at IS NOT NULL OR t.situacao <> 'ativo' THEN
      RAISE EXCEPTION 'empresa % existe, mas não está ativa (situação %, excluída: %); nada foi alterado',
        v_slug, t.situacao, t.deleted_at IS NOT NULL USING ERRCODE = 'P0001';
    END IF;
    v_tenant := t.id;
    saida := saida || format('empresa|%s|existia|%s', v_slug, v_tenant);
  ELSE
    v_tenant := gen_random_uuid();
    IF NOT v_simular THEN
      PERFORM set_config('app.tenant_id', v_tenant::text, true);
      INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES (v_tenant, v_tenant, v_slug, v_nome);
      INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
      VALUES (v_tenant, NULL, 'plataforma.empresa.criar', 'tenant', v_tenant, NULL,
        jsonb_build_object('slug', v_slug, 'situacao', 'ativo', 'operador', v_operador, 'motivo', 'primeiro acesso'), v_req);
    END IF;
    saida := saida || format('empresa|%s|%s|%s', v_slug, CASE WHEN v_simular THEN 'criar' ELSE 'criado' END,
      CASE WHEN v_simular THEN '-' ELSE v_tenant::text END);
  END IF;
  -- RLS do tenant na transação (as políticas usam plataforma.tenant_atual()); vale também se a tabela tiver FORCE RLS
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  -- administrador: se o e-mail já existe na empresa (mesmo inativo ou excluído), NADA muda (nem a senha)
  SELECT id, ativo, deleted_at INTO u FROM plataforma.usuario WHERE tenant_id = v_tenant AND email = v_email;
  IF FOUND THEN
    saida := saida || format('usuario|administrador|%s|%s',
      CASE WHEN u.deleted_at IS NOT NULL THEN 'existia-excluido' WHEN NOT u.ativo THEN 'existia-inativo' ELSE 'existia' END, u.id);
  ELSIF v_simular THEN
    saida := saida || 'usuario|administrador|criar|-'::text;
  ELSE
    IF v_hash NOT LIKE '$argon2id$%' THEN
      RAISE EXCEPTION 'hash da senha fora do formato argon2id' USING ERRCODE = 'P0001';
    END IF;
    v_usuario := gen_random_uuid();
    INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil)
    VALUES (v_usuario, v_tenant, v_email, v_admin_nome, v_hash, 'administrador');
    INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
    VALUES (v_tenant, NULL, 'plataforma.usuario.criar', 'usuario', v_usuario, NULL,
      jsonb_build_object('perfil', 'administrador', 'ativo', true, 'operador', v_operador, 'motivo', 'primeiro acesso'), v_req);
    saida := saida || format('usuario|administrador|criado|%s', v_usuario);
  END IF;

  -- licenças pedidas: liga a que falta, está desligada, excluída ou vencida; a ativa fica como está
  FOREACH m IN ARRAY v_modulos LOOP
    SELECT id, ativo, valido_ate, deleted_at INTO l FROM plataforma.tenant_modulo WHERE tenant_id = v_tenant AND modulo = m;
    v_existia := FOUND;
    IF v_existia AND l.deleted_at IS NULL AND l.ativo AND (l.valido_ate IS NULL OR l.valido_ate > now()) THEN
      saida := saida || format('licenca|%s|ja-ativa|%s', m, l.id);
      CONTINUE;
    END IF;
    IF v_simular THEN
      saida := saida || format('licenca|%s|ligar|%s', m, COALESCE(l.id::text, '-'));
      CONTINUE;
    END IF;
    IF v_existia THEN
      UPDATE plataforma.tenant_modulo SET ativo = true, valido_ate = NULL, deleted_at = NULL WHERE id = l.id;
      v_lic := l.id;
    ELSE
      v_lic := gen_random_uuid();
      INSERT INTO plataforma.tenant_modulo (id, tenant_id, modulo, ativo) VALUES (v_lic, v_tenant, m, true);
    END IF;
    INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id)
    VALUES (v_tenant, NULL, 'plataforma.licenca.alterar', 'tenant_modulo', v_lic,
      CASE WHEN v_existia THEN jsonb_build_object('ativo', l.ativo, 'valido_ate', l.valido_ate, 'excluida', l.deleted_at IS NOT NULL) END,
      jsonb_build_object('ativo', true, 'valido_ate', NULL, 'modulo', m, 'operador', v_operador, 'motivo', 'primeiro acesso'), v_req);
    saida := saida || format('licenca|%s|ligada|%s', m, v_lic);
  END LOOP;

  -- as outras (faturamento, fiscal) não são tocadas: só informa
  FOR l IN SELECT x.modulo, tm.id, tm.ativo, tm.deleted_at
           FROM unnest(ARRAY[${MODULOS_INFORMAR.map((x) => `'${x}'`).join(', ')}]) AS x(modulo)
           LEFT JOIN plataforma.tenant_modulo tm ON tm.tenant_id = v_tenant AND tm.modulo = x.modulo LOOP
    saida := saida || format('licenca|%s|%s|%s', l.modulo,
      CASE WHEN l.id IS NULL THEN 'ausente' WHEN l.deleted_at IS NULL AND l.ativo THEN 'ativa-sem-mudanca' ELSE 'desligada' END,
      COALESCE(l.id::text, '-'));
  END LOOP;

  PERFORM set_config('macuxierp_op.saida', array_to_string(saida, E'\\n'), true);
END $$;
SELECT current_setting('macuxierp_op.saida');
${simular ? 'ROLLBACK' : 'COMMIT'};
`;
}

const TEXTO = {
  empresa: { existia: 'já existia', criado: 'criada', criar: 'seria criada' },
  usuario: {
    existia: 'já existia (senha NÃO alterada)',
    'existia-inativo': 'já existia, INATIVO (senha NÃO alterada; reative pelo BKO)',
    'existia-excluido': 'já existia, EXCLUÍDO (nada alterado)',
    criado: 'criado',
    criar: 'seria criado',
  },
  licenca: { 'ja-ativa': 'já ativa', ligada: 'ligada', ligar: 'seria ligada', ausente: 'sem licença (não mexida)', desligada: 'desligada (não mexida)', 'ativa-sem-mudanca': 'ativa (não mexida)' },
};

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
    console.error(`[empresa] ${e instanceof ErroUso ? e.message : 'argumentos inválidos'}`);
    return 2;
  }
  delete process.env.MACUXIERP_SENHA_INICIAL;
  let hash = '';
  try {
    if (op.confirmar) hash = await hashSenha(op.senha);
  } catch (e) {
    console.error(`[empresa] ${e.message}`);
    return 1;
  }
  const filho = { ...env };
  for (const k of ['MACUXIERP_SENHA_INICIAL', 'MACUXIERP_EMPRESA_NOME', 'MACUXIERP_ADMIN_EMAIL', 'MACUXIERP_ADMIN_NOME']) delete filho[k];
  Object.assign(filho, {
    MACUXIERP_OP_SLUG: op.slug,
    MACUXIERP_OP_NOME: op.nome,
    MACUXIERP_OP_EMAIL: op.email,
    MACUXIERP_OP_ADMIN_NOME: op.adminNome,
    MACUXIERP_OP_HASH: hash,
    MACUXIERP_OP_OPERADOR: op.operador,
    MACUXIERP_OP_REQUEST_ID: `operador-${crypto.randomUUID()}`,
    MACUXIERP_OP_SIMULAR: op.confirmar ? 'false' : 'true',
    MACUXIERP_OP_MODULOS: MODULOS_LIGAR.join(','),
  });
  const r = spawnSync(env.MACUXIERP_PSQL || 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-At', '-f', '-'], {
    input: montarSql(!op.confirmar),
    env: filho,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) {
    const msg = r.error ? `psql não executou (${r.error.code ?? r.error.name})` : errosSeguros(r.stderr ?? '', [op.nome, op.email, op.adminNome, hash, op.senha]);
    console.error(`[empresa] falhou; nada foi gravado (transação desfeita).\n${msg}`);
    return 1;
  }
  const itens = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.split('|'))
    .filter((c) => c.length === 4 && TEXTO[c[0]]);
  const usuario = itens.find((c) => c[0] === 'usuario');
  if (!itens.some((c) => c[0] === 'empresa') || !usuario) {
    console.error('[empresa] resposta do banco fora do esperado; confira com o licenca.mjs listar');
    return 1;
  }
  console.log(op.confirmar ? '[empresa] APLICADO e auditado (plataforma.auditoria, motivo "primeiro acesso").' : '[empresa] SIMULAÇÃO: nada gravado.');
  for (const [tipo, chave, situacao, id] of itens) {
    const rotulo = tipo === 'empresa' ? `empresa ${chave}` : tipo === 'usuario' ? 'administrador' : `licença ${chave}`;
    console.log(`  ${rotulo}: ${TEXTO[tipo][situacao] ?? situacao}${id !== '-' ? ` (id ${id})` : ''}`);
  }
  console.log(`estado: ${!op.confirmar ? 'simulacao' : usuario[2] === 'criado' ? 'usuario-criado' : 'usuario-existia'}`);
  return 0;
}

// `node - <args>` (stdin) e `node empresa.mjs <args>` deixam os argumentos a partir do índice 2
process.exitCode = await main(process.argv.slice(2), process.env);
