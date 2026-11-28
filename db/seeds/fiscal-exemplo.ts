/**
 * Seed fiscal de EXEMPLO (T-0127): carrega db/seeds/fiscal-exemplo.sql num banco de teste ou de desenvolvimento, com
 * o tenant de teste. Fora da imagem de produção (o apps/api/Dockerfile copia só db/src, db/migrations e
 * db/tabelas-fiscais) e fora do migrar: só o e2e, os testes e o desenvolvimento chamam. Idempotente.
 */
import { readFileSync } from 'node:fs';
import { type Conexao, rodarScript } from '../src/psql.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Caminho do SQL do seed. */
export const SEED_FISCAL_EXEMPLO = new URL('./fiscal-exemplo.sql', import.meta.url);

/**
 * Script completo (uma transação, tudo ou nada) para quem roda pelo driver pg: `await pool.query(sqlSeedFiscalExemplo(id))`
 * como o admin do banco efêmero. O tenant vai em macuxierp.seed_tenant (SET LOCAL), conferido como UUID.
 */
export function sqlSeedFiscalExemplo(tenantTeste: string): string {
  if (!UUID.test(tenantTeste)) throw new Error('seed fiscal de exemplo: tenant de teste não é um UUID');
  return [
    'BEGIN;',
    `SELECT set_config('macuxierp.seed_tenant', '${tenantTeste}', true);`,
    readFileSync(SEED_FISCAL_EXEMPLO, 'utf8'),
    'COMMIT;',
  ].join('\n');
}

/** Carrega o seed pelo psql (testes de banco e desenvolvimento), como o admin da conexão. */
export function carregarSeedFiscalExemplo(conexao: Conexao, tenantTeste: string): void {
  rodarScript(conexao, sqlSeedFiscalExemplo(tenantTeste));
}
