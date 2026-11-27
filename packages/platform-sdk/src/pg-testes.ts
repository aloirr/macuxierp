/**
 * Apoio dos testes de banco dos apps (`*.db.test.ts`, `@macuxierp/platform-sdk/pg-testes`): banco efêmero
 * `macuxi_teste_*` migrado pela CLI do `@macuxierp/db` (como o admin do ambiente: o superusuário na 5432 ou o admin sem
 * superusuário na 5433, variáveis `MACUXI_PG_*` do `db/scripts/pg-local.sh`), e `BancoPg` nos papéis da aplicação
 * (`SET LOCAL ROLE`), para a RLS valer. Sem Postgres, o teste pula, salvo com `MACUXI_PG_EXIGIR=1`, quando falha.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pg from 'pg';
import type { Transacao } from './banco';
import { BancoPg } from './pg';

/**
 * Prazo dos hooks do arquivo de teste que importa este apoio. O `beforeAll` lê o `hookTimeout` do runner no registro, que
 * vem depois das importações; o vitest volta a config ao fim de cada arquivo (`vi.resetConfig`). Os 10 s padrão não
 * bastam no CI, com o turbo rodando vários pacotes em paralelo: `CREATE DATABASE` + a CLI de migração passavam disso.
 * O `vitest` entra por import dinâmico (top-level await) e só sob o vitest (`VITEST`): fora dele, o `vi` quebra ("Vitest
 * failed to access its internal state") e o apoio também é usado fora do runner (`tests/e2e/api-real.ts`, vite-node).
 */
export const PRAZO_HOOK_BANCO_MS = 120_000;
if (process.env.VITEST) {
  const { vi } = await import('vitest');
  vi.setConfig({ hookTimeout: PRAZO_HOOK_BANCO_MS });
}

const env = process.env;

/** Roda a CLI de migração num processo novo, sem bloquear o event loop do worker do vitest. */
function migrar(cli: string, banco: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, [cli], { env: { ...env, MACUXIERP_BANCO: banco }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    filho.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // Falha ao criar o processo vira status null com a mensagem, sem lançar aqui.
    filho.on('error', (e) => resolver({ status: null, stdout, stderr: stderr || e.message }));
    filho.on('close', (status) => resolver({ status, stdout, stderr }));
  });
}
const ADMIN: pg.PoolConfig = {
  host: env.MACUXI_PG_HOST ?? '127.0.0.1',
  port: Number(env.MACUXI_PG_PORTA ?? 5432),
  user: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  password: env.MACUXI_PG_ADMIN_SENHA,
  max: 4,
};

async function postgresDisponivel(): Promise<boolean> {
  const c = new pg.Client({ ...ADMIN, database: 'postgres', connectionTimeoutMillis: 3_000 });
  try {
    await c.connect();
    return true;
  } catch (e) {
    if (env.MACUXI_PG_EXIGIR === '1') throw new Error(`MACUXI_PG_EXIGIR=1 e o Postgres não respondeu: ${(e as Error).message}`);
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

export const PG_DISPONIVEL = await postgresDisponivel();

/**
 * Fecha o pool e espera cada conexão terminar de verdade. O `pool.end()` do pg-pool resolve quando tira os clientes da
 * lista, antes de o `client.end()` acabar; o `DROP DATABASE ... WITH (FORCE)` logo depois derrubava a conexão ainda
 * viva e o 57P01 virava `'error'` do pool sem ouvinte ("Unhandled Errors" no vitest). O evento `remove` sai no fim do
 * `client.end()`.
 */
async function encerrarPool(pool: pg.Pool): Promise<void> {
  const total = pool.totalCount;
  let removidos = 0;
  const todosFechados = new Promise<void>((resolver) => {
    if (total === 0) resolver();
    pool.on('remove', () => {
      if (++removidos >= total) resolver();
    });
  });
  await pool.end();
  await todosFechados;
}

export type PapelApp = 'macuxierp_app' | 'macuxierp_worker';

export interface BancoEfemero {
  nome: string;
  /** Conexão do admin (dono das tabelas, fora da RLS): massa de teste e conferências. */
  admin: pg.Pool;
  /** `BancoPg` num pool próprio, no papel pedido (`max` 1 = sempre a mesma conexão). */
  banco(papel: PapelApp, max?: number): BancoPg;
  remover(): Promise<void>;
}

export async function criarBancoEfemero(): Promise<BancoEfemero> {
  const nome = `macuxi_teste_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const raiz = new pg.Client({ ...ADMIN, database: 'postgres' });
  await raiz.connect();
  await raiz.query(`CREATE DATABASE ${nome}`).finally(() => raiz.end());

  const cli = join(dirname(createRequire(import.meta.url).resolve('@macuxierp/db/package.json')), 'src', 'cli', 'migrar.ts');
  const r = await migrar(cli, nome);
  if (r.status !== 0) throw new Error(`migração do banco de teste falhou: ${(r.stderr || r.stdout).trim()}`);

  const admin = new pg.Pool({ ...ADMIN, database: nome });
  // O admin sem superusuário criou os papéis (ADMIN OPTION) e se concede, para o SET ROLE.
  await admin.query(`DO $$ BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
      GRANT macuxierp_app, macuxierp_worker TO CURRENT_USER;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`);
  const pools: pg.Pool[] = [];
  return {
    nome,
    admin,
    banco(papel, max = 4) {
      const pool = new pg.Pool({ ...ADMIN, database: nome, max });
      pools.push(pool);
      return new BancoPg(pool, { papel });
    },
    async remover() {
      await Promise.all([admin, ...pools].map(encerrarPool));
      const c = new pg.Client({ ...ADMIN, database: 'postgres' });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`).finally(() => c.end());
    },
  };
}

/** Tenant ativo com licença dos módulos pedidos (gravado pelo admin, fora da RLS). Devolve o id. */
export async function criarTenant(admin: pg.Pool, slug: string, modulos: readonly string[] = []): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ($1, $1, $2, 'Empresa ' || $2)", [id, slug]);
  for (const m of modulos) await admin.query('INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ($1, $2)', [id, m]);
  return id;
}

/**
 * RD-2261: um superadmin ativo (sem trocar senha) e uma sessão válida por 8 h, gravados pelo admin. Hash de senha fictício:
 * o teste não faz login, usa a sessão direto pelo `comoConfig`.
 */
export async function semearSessaoSuperadmin(admin: pg.Pool): Promise<{ superadmin_id: string; sessao_id: string }> {
  const superadmin_id = randomUUID();
  const sessao_id = randomUUID();
  await admin.query(
    `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
     VALUES ($1, $2, 'Superadmin Ficticio', '$argon2id$v=19$m=19456,t=2,p=1$ZmljdGljaW8$ZmljdGljaW9maWN0aWNpb2ZpY3RpY2lvZmljdGljaW8', false, true)`,
    [superadmin_id, `sa-${superadmin_id.slice(0, 8)}@plataforma.teste`],
  );
  await admin.query(
    `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
     VALUES ($1::uuid, $2, encode(sha256(convert_to($1::text, 'UTF8')), 'hex'), now() + interval '8 hours', now())`,
    [sessao_id, superadmin_id],
  );
  return { superadmin_id, sessao_id };
}

/**
 * RD-2261: uma transação no papel `macuxierp_config` com a sessão do superadmin (o que o `comPlataforma` da apps/api faz),
 * para chamar as funções `portal_*` nos testes. COMMIT no fim; ROLLBACK e a exceção repassada no erro.
 */
export async function comoConfig<R>(
  admin: pg.Pool,
  sessaoId: string,
  fn: (consultar: (sql: string, parametros?: readonly unknown[]) => Promise<Record<string, unknown>[]>) => Promise<R>,
): Promise<R> {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DO $$ BEGIN IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN GRANT macuxierp_config TO CURRENT_USER; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    await c.query('SET LOCAL ROLE macuxierp_config');
    await c.query("SELECT set_config('macuxierp.sessao_superadmin', $1, true)", [sessaoId]);
    const r = await fn(async (sql, parametros = []) => (await c.query(sql, parametros as unknown[])).rows);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** RD-2349: o mesmo `comoConfig`, entregando uma `Transacao` do SDK (o que os repositórios dos módulos recebem). */
export function comoConfigTx<R>(admin: pg.Pool, sessaoId: string, fn: (tx: Transacao) => Promise<R>): Promise<R> {
  return comoConfig(admin, sessaoId, (consultar) =>
    fn({ consultar: <L = Record<string, unknown>>(sql: string, parametros?: readonly unknown[]) => consultar(sql, parametros) as Promise<L[]> }),
  );
}
