/**
 * T-0050 (E6.3): o superadmin no banco (ADR 0012 §1 e §4; migração 0033), no PostgreSQL local (bash
 * db/scripts/pg-local.sh), pelos papéis reais com SET LOCAL ROLE, como a API faz:
 * - macuxierp_app, macuxierp_worker e macuxierp_leitura não leem plataforma.superadmin nem plataforma.sessao_superadmin;
 * - macuxierp_config sem BYPASSRLS (nem superusuário, nem login); função da lista fechada sem sessão = SQLSTATE MXS01;
 * - macuxierp_config não lê nenhuma tabela dos schemas de módulo (descobertos no catálogo: schema novo entra sozinho),
 *   nem as tabelas de tenant do schema plataforma: o superadmin não lê dado de negócio;
 * - a auditoria do portal grava superadmin_id, o tenant ALVO e usuario_id nulo, sem nome de empresa nem e-mail.
 * Complementa db/testes/superadmin-0033.db.test.ts (banco-dados) pelo lado dos testes: matriz por papel e por tabela.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { comoPapel, erroComoPapel, PAPEL_CONFIG as CONFIG, sha256 as sha, type ClientePg, type OpcoesPapel } from '../../apoio/portal-pg';

const PAPEIS_TENANT = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const TABELAS_SUPERADMIN = ['plataforma.superadmin', 'plataforma.sessao_superadmin'] as const;
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
/** Schemas fora do negócio (catálogo e controle de migração); o resto do banco é de módulo ou da plataforma. */
const SCHEMAS_SISTEMA = ['pg_catalog', 'information_schema', 'pg_toast', 'controle', 'public'];
const HASH_FICTICIO = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

/** Funções da lista fechada que exigem sessão (ADR 0012 §4), com argumentos válidos de forma. */
const COM_SESSAO: readonly [string, string][] = [
  ['empresas_listar', "plataforma.empresas_listar(NULL, NULL, 10)"],
  ['empresa_ler', `plataforma.empresa_ler('${randomUUID()}')`],
  ['empresa_criar', "plataforma.empresa_criar('e6-sem-sessao', 'Empresa Fictícia', 'America/Manaus', 'req-e6')"],
  ['empresa_situacao', `plataforma.empresa_situacao('${randomUUID()}', 'suspenso', 'motivo do teste', 'req-e6')`],
  ['empresa_modulos', `plataforma.empresa_modulos('${randomUUID()}', '[{"modulo":"cadastros","ativo":true,"valido_ate":null}]'::jsonb, 'req-e6')`],
  ['empresa_primeiro_admin_criar', `plataforma.empresa_primeiro_admin_criar('${randomUUID()}', 'adm@exemplo.invalid', 'Pessoa Fictícia', '${HASH_FICTICIO}', 'req-e6')`],
  ['empresa_primeiro_admin_senha', `plataforma.empresa_primeiro_admin_senha('${randomUUID()}', '${HASH_FICTICIO}', 'req-e6')`],
  ['superadmin_sair', `plataforma.superadmin_sair('${randomUUID()}')`],
  ['superadmin_senha_atual', 'plataforma.superadmin_senha_atual()'],
  ['superadmin_trocar_senha', `plataforma.superadmin_trocar_senha('${HASH_FICTICIO}', '${HASH_FICTICIO}')`],
  ['idem_plataforma_reservar', `plataforma.idem_plataforma_reservar('chave-e6', 'POST /v1/plataforma/empresas', '${sha('corpo')}')`],
  ['idem_plataforma_concluir', `plataforma.idem_plataforma_concluir('chave-e6', 'POST /v1/plataforma/empresas', 201, NULL)`],
];

describe.skipIf(!PG_DISPONIVEL)('superadmin no banco: papéis, RLS e lista fechada (T-0050 E6.3, ADR 0012 §1 e §4, migração 0033)', () => {
  let b: BancoEfemero;
  let tenant = '';
  let superadmin = '';

  const como = <T>(papel: string, o: OpcoesPapel, fn: (c: ClientePg) => Promise<T>): Promise<T> => comoPapel(b, papel, o, fn);
  const erroComo = (papel: string, o: OpcoesPapel, sql: string) => erroComoPapel(b, papel, o, sql);
  /** Sessão aberta pela função da 0033 (no papel do portal, como a API depois do argon2). Devolve o id da sessão. */
  const abrirSessao = () =>
    como(CONFIG, { confirmar: true }, async (c) => {
      const { rows } = await c.query("SELECT plataforma.superadmin_abrir_sessao($1::uuid, $2, now() + interval '1 hour') AS id", [superadmin, sha(randomUUID())]);
      return rows[0].id as string;
    });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'e6-rls-a', ['cadastros', 'pedido', 'fiscal', 'faturamento']);
    const { rows } = await b.admin.query(
      "INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ('sa-e6-rls@exemplo.invalid', 'Superadmin Fictício', $1, false, true) RETURNING id",
      [HASH_FICTICIO],
    );
    superadmin = rows[0].id;
  }, 180_000);
  afterAll(async () => {
    await b?.remover();
  });

  it('ADR 0012 §1: app, worker e leitura não leem superadmin nem sessao_superadmin (42501), com ou sem tenant na sessão', async () => {
    await abrirSessao();
    const fora: string[] = [];
    // o 42501 abaixo é da tabela, não do SET ROLE (que também seria 42501): o papel entrou de fato
    for (const papel of [...PAPEIS_TENANT, CONFIG]) expect(await como(papel, {}, async (c) => (await c.query('SELECT current_user AS u')).rows[0].u)).toBe(papel);
    for (const papel of PAPEIS_TENANT) {
      for (const t of TABELAS_SUPERADMIN) {
        for (const tn of [undefined, tenant, REFERENCIA]) {
          const e = await erroComo(papel, { tenant: tn }, `SELECT * FROM ${t} LIMIT 1`);
          if (e !== '42501') fora.push(`${papel} ${t} tenant=${tn ?? '-'} → ${e ?? 'leu'}`);
        }
        const { rows } = await b.admin.query(
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS algum",
          [papel, t],
        );
        if (rows[0].algum) fora.push(`${papel} tem privilégio em ${t}`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('ADR 0012 §1: macuxierp_config sem BYPASSRLS, sem superusuário e sem login; o app só entra nele por SET ROLE', async () => {
    const { rows } = await b.admin.query('SELECT rolbypassrls, rolsuper, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1', [CONFIG]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false, rolcanlogin: false });
    // nenhum papel de tenant herda o config (o app é membro com INHERIT false)
    for (const papel of PAPEIS_TENANT) {
      const h = await b.admin.query("SELECT pg_has_role($1, $2, 'USAGE') AS herda", [papel, CONFIG]);
      expect(h.rows[0].herda, papel).toBe(false);
    }
    // e o config não tem privilégio direto nas próprias tabelas: só as funções SECURITY DEFINER leem
    for (const t of TABELAS_SUPERADMIN) expect(await erroComo(CONFIG, {}, `SELECT * FROM ${t} LIMIT 1`), t).toBe('42501');
  });

  it('ADR 0012 §4: função da lista fechada sem sessão (ou com sessão inexistente ou malformada) falha com MXS01', async () => {
    const fora: string[] = [];
    for (const [nome, chamada] of COM_SESSAO) {
      for (const sessao of [undefined, randomUUID(), 'nao-e-uuid']) {
        const e = await erroComo(CONFIG, { sessao }, `SELECT ${chamada}`);
        if (e !== 'MXS01') fora.push(`${nome} sessao=${sessao ?? '-'} → ${e ?? 'passou'}`);
      }
    }
    expect(fora).toEqual([]);
    // com a sessão válida, a mesma leitura passa (o MXS01 é da sessão, não de privilégio)
    const sessao = await abrirSessao();
    expect(await erroComo(CONFIG, { sessao }, 'SELECT plataforma.empresas_listar(NULL, NULL, 10)')).toBeNull();
    // os papéis de tenant nem executam as funções do portal (42501), com ou sem sessão
    for (const papel of PAPEIS_TENANT) expect(await erroComo(papel, { tenant, sessao }, 'SELECT plataforma.empresas_listar(NULL, NULL, 10)'), papel).toBe('42501');
  });

  it('ADR 0012 §1: macuxierp_config, mesmo com sessão válida, não lê nenhuma tabela de módulo nem as de tenant da plataforma', async () => {
    const { rows: tabelas } = await b.admin.query<{ s: string; t: string }>(
      `SELECT n.nspname AS s, c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname <> ALL($1) AND n.nspname NOT LIKE 'pg_%'
       ORDER BY 1, 2`,
      [SCHEMAS_SISTEMA],
    );
    const schemas = new Set(tabelas.map((x) => x.s));
    // os nomes reais dos schemas de módulo (0001 e 0025): se um sumir ou mudar de nome, o teste avisa
    for (const s of ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao_fdv', 'sefaz_simulador', 'plataforma']) expect(schemas.has(s), s).toBe(true);
    const sessao = await abrirSessao();
    const fora: string[] = [];
    for (const { s, t } of tabelas) {
      const nome = `${s}.${t}`;
      const { rows } = await b.admin.query("SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS algum", [CONFIG, `"${s}"."${t}"`]);
      if (rows[0].algum) fora.push(`privilégio em ${nome}`);
      const e = await erroComo(CONFIG, { sessao, tenant }, `SELECT 1 FROM "${s}"."${t}" LIMIT 1`);
      if (e !== '42501') fora.push(`${nome} → ${e ?? 'leu'}`);
    }
    expect(tabelas.length).toBeGreaterThan(50);
    expect(fora).toEqual([]);
    // o config só usa os schemas plataforma, integracao_fdv (0038, ADR 0013), cadastros (0040, carga pelo portal) e pedido e faturamento (0043, zerar) e core (zerar-v3, v0.3.6); nenhum outro, e nenhuma tabela
    const usados: string[] = [];
    for (const s of schemas) {
      const { rows } = await b.admin.query("SELECT has_schema_privilege($1, $2, 'USAGE') AS usa", [CONFIG, s]);
      if (rows[0].usa) usados.push(s);
    }
    usados.sort();
    expect(usados).toContain('plataforma');
    expect(usados.every((s) => ['plataforma', 'integracao_fdv', 'cadastros', 'pedido', 'faturamento', 'core'].includes(s)), usados.join()).toBe(true);
  });

  it('ADR 0012 §1 e §4: a auditoria do portal grava superadmin_id, o tenant alvo e usuario_id nulo, sem nome nem e-mail', async () => {
    const sessao = await abrirSessao();
    const req = `req-e6-${randomUUID().slice(0, 8)}`;
    const criada = await como(CONFIG, { sessao, confirmar: true }, async (c) => {
      const { rows } = await c.query("SELECT plataforma.empresa_criar('e6-auditoria', 'Empresa Auditoria Fictícia', 'America/Manaus', $1) AS e", [req]);
      const e = rows[0].e as { id: string };
      await c.query(`SELECT plataforma.empresa_modulos($1, '[{"modulo":"cadastros","ativo":true,"valido_ate":null}]'::jsonb, $2)`, [e.id, req]);
      await c.query("SELECT plataforma.empresa_situacao($1, 'suspenso', 'motivo fictício do teste', $2)", [e.id, req]);
      return e;
    });
    const { rows } = await b.admin.query(
      'SELECT tenant_id, usuario_id, superadmin_id, acao, antes::text AS antes, depois::text AS depois FROM plataforma.auditoria WHERE request_id = $1 ORDER BY ocorrido_em, acao',
      [req],
    );
    expect(rows.map((r) => r.acao).sort()).toEqual(['plataforma.empresa.criar', 'plataforma.empresa.situacao', 'plataforma.modulos.alterar']);
    for (const r of rows) {
      expect(r, r.acao).toMatchObject({ tenant_id: criada.id, usuario_id: null, superadmin_id: superadmin });
      expect(`${r.antes ?? ''}${r.depois ?? ''}`, r.acao).not.toMatch(/Empresa Auditoria|@exemplo\.invalid|Superadmin Fictício|argon2/);
    }
    // a entrada (abrir sessão) também é do superadmin, no tenant de referência, sem usuario_id
    const entrar = await b.admin.query("SELECT DISTINCT tenant_id, usuario_id FROM plataforma.auditoria WHERE superadmin_id = $1 AND acao = 'plataforma.superadmin.entrar'", [superadmin]);
    expect(entrar.rows).toEqual([{ tenant_id: REFERENCIA, usuario_id: null }]);
    // o app não forja autoria de superadmin (INSERT por coluna, sem superadmin_id)
    const forjar = await erroComo('macuxierp_app', { tenant }, `INSERT INTO plataforma.auditoria (tenant_id, superadmin_id, acao, entidade) VALUES ('${tenant}', '${superadmin}', 'x', 'y')`);
    expect(forjar).toBe('42501');
  });
});
