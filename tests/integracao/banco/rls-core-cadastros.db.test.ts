/**
 * T-0008 (b): RLS entre tenants no PostgreSQL local (bash db/scripts/pg-local.sh), papel macuxierp_app, em toda tabela
 * dos schemas core e cadastros (descobertas no catálogo: tabela nova entra sozinha).
 * Só o que os testes do banco-dados não cobrem: INSERT com tenant_id alheio (42501 da política), leitura de linha alheia
 * pelo id e tenant malformado na sessão (22P02). Colunas comuns, RLS ligada e papéis: db/testes/plataforma.db.test.ts;
 * leitura, UPDATE, DELETE e sessão sem tenant: db/testes/vazamento.ts (modulos.db.test.ts); tabelas oficiais:
 * db/testes/oficiais.db.test.ts.
 * Massa: db/testes/fixture.ts (uma linha em cada tabela por tenant). Sem Postgres, pula; com MACUXI_PG_EXIGIR=1, falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { fixtureModulos, fixturePlataforma, novoTenant } from '../../../db/testes/fixture';

/** O que o teste usa do cliente do pool do admin (a raiz não tem @types/pg). */
interface ClientePg {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  release(): void;
}

const A = novoTenant('t0008-rls-a');
const B = novoTenant('t0008-rls-b');
const APP = 'macuxierp_app';

interface Tabela {
  nome: string;
  oficial: boolean;
}

const codigo = (e: unknown) => (e as { code?: string }).code ?? String(e);
/** "42501 row-level security" = recusa da política (não só falta de privilégio, que também é 42501). */
const daRls = (e: unknown) => `${codigo(e)}${/row-level security/.test((e as Error).message) ? ' row-level security' : ''}`;

describe.skipIf(!PG_DISPONIVEL)('RLS de core e cadastros no PostgreSQL (papel macuxierp_app)', () => {
  let b: BancoEfemero;
  let tabelas: Tabela[] = [];

  /** Roda `fn` como o app, numa transação desfeita no fim (SET LOCAL ROLE e app.tenant_id, como a API faz). */
  async function comoApp<T>(tenant: string | null, fn: (c: ClientePg) => Promise<T>): Promise<T> {
    const c = (await b.admin.connect()) as unknown as ClientePg;
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${APP}`);
      if (tenant !== null) await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  }
  /** Código do erro do PostgreSQL, ou null se passou. */
  async function erroComoApp(tenant: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await comoApp(tenant, (c) => c.query(sql, params));
      return null;
    } catch (e) {
      return daRls(e);
    }
  }
  async function privilegio(t: string, p: 'SELECT' | 'INSERT'): Promise<boolean> {
    const fn = p === 'SELECT' ? 'has_any_column_privilege' : 'has_table_privilege';
    const r = await b.admin.query(`SELECT ${fn}($1, $2, $3) AS ok`, [APP, t, p]);
    return r.rows[0].ok === true;
  }
  /** Assinatura das linhas do tenant (visão do admin, fora da RLS): conta, maior updated_at e hash do conteúdo. */
  async function assinatura(t: string, tenant: string): Promise<string> {
    const r = await b.admin.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x WHERE tenant_id = $1`, [tenant]);
    return JSON.stringify(r.rows[0]);
  }
  const naoOficiais = () => tabelas.filter((t) => !t.oficial);

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query([A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
    const r = await b.admin.query<{ nome: string; oficial: boolean }>(
      `SELECT n.nspname || '.' || k.relname AS nome,
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = k.relname
                      AND p.policyname = 'isolamento_tenant' AND p.qual LIKE '%tenant_referencia()%') AS oficial
       FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
       WHERE k.relkind IN ('r', 'p') AND n.nspname IN ('core', 'cadastros') ORDER BY 1`,
    );
    tabelas = r.rows;
  });
  afterAll(async () => {
    await b?.remover();
  });

  it('leitura: no tenant A o app não lê nenhuma linha de B nem buscando pelo id dela', async () => {
    const problemas: string[] = [];
    let testadas = 0;
    for (const t of naoOficiais()) {
      if (!(await privilegio(t.nome, 'SELECT'))) continue;
      const idsB = (await b.admin.query(`SELECT id FROM ${t.nome} WHERE tenant_id = $1`, [B.id])).rows.map((x) => x.id);
      if (idsB.length === 0) problemas.push(`${t.nome}: a massa não tem linha do tenant B`);
      const porId = await comoApp(A.id, (c) => c.query(`SELECT count(*)::int AS n FROM ${t.nome} WHERE id = ANY($1::uuid[])`, [idsB]));
      testadas++;
      if (porId.rows[0].n > 0) problemas.push(`${t.nome}: o app leu linha de B pelo id`);
    }
    expect(testadas).toBeGreaterThanOrEqual(15);
    expect(problemas).toEqual([]);
  });

  it('escrita: no tenant A o app não insere linha com tenant_id de B (42501 da RLS) e B fica intacto', async () => {
    const problemas: string[] = [];
    let testadas = 0;
    for (const t of naoOficiais()) {
      if (!(await privilegio(t.nome, 'INSERT'))) continue;
      const modelo = (await b.admin.query(`SELECT to_jsonb(x) AS j FROM ${t.nome} x WHERE tenant_id = $1 LIMIT 1`, [B.id])).rows[0]?.j;
      if (!modelo) continue;
      const antes = await assinatura(t.nome, B.id);
      const linha = { ...modelo, id: randomUUID(), external_id: `t0008-${randomUUID()}` };
      const erro = await erroComoApp(A.id, `INSERT INTO ${t.nome} SELECT * FROM jsonb_populate_record(NULL::${t.nome}, $1::jsonb)`, [JSON.stringify(linha)]);
      testadas++;
      if (erro !== '42501 row-level security') problemas.push(`${t.nome}: INSERT com tenant de B deu ${erro ?? 'SUCESSO'} (esperado 42501 da RLS)`);
      if ((await assinatura(t.nome, B.id)) !== antes) problemas.push(`${t.nome}: linhas de B mudaram`);
    }
    expect(testadas).toBeGreaterThanOrEqual(15);
    expect(problemas).toEqual([]);
  });

  it('falha fechada: tenant que não é UUID na sessão dá erro 22P02 (nunca "todos")', async () => {
    expect(await erroComoApp('nao-e-uuid', 'SELECT count(*) FROM cadastros.cliente')).toBe('22P02');
  });
});
