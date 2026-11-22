/**
 * Apoio dos testes de banco dos apps (`*.db.test.ts`, `@macuxierp/platform-sdk/pg-testes`): banco efêmero
 * `macuxi_teste_*` migrado pela CLI do `@macuxierp/db` (como o admin do ambiente: o superusuário na 5432 ou o admin sem
 * superusuário na 5433, variáveis `MACUXI_PG_*` do `db/scripts/pg-local.sh`), e `BancoPg` nos papéis da aplicação
 * (`SET LOCAL ROLE`), para a RLS valer. Sem Postgres, o teste pula, salvo com `MACUXI_PG_EXIGIR=1`, quando falha.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { BancoPg } from './pg';

const env = process.env;
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
  const r = spawnSync(process.execPath, [cli], { env: { ...env, MACUXIERP_BANCO: nome }, encoding: 'utf8' });
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
