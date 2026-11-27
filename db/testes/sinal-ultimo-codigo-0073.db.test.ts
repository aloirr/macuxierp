/**
 * v0.3.18, migração 0073: integracao_fdv.sinal.ultimo_codigo (nulo; o código do Hub ou http_<status>) para o worker
 * guardar por que o último sinal falhou. Motivo em docs/banco/README.md (0073). Dados fictícios.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0073_integracao_fdv_sinal_ultimo_codigo.sql', import.meta.url));
const A = novoTenant('sinal-0073-a');
const B = novoTenant('sinal-0073-b');
const COMO = (papel: string, t: Tenant | null) => ({ papel, tenant: t?.id ?? null });

const gravar = (valor: string) =>
  `WITH u AS (UPDATE integracao_fdv.sinal SET ultimo_codigo = ${valor}, updated_at = now() WHERE tenant_id = plataforma.tenant_atual()
     RETURNING 1) SELECT count(*) FROM u;`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — integracao_fdv.sinal.ultimo_codigo (v0.3.18, 0073)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureIntegracao(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('a coluna é text e nula (a linha antiga fica sem código)', () => {
    const [c] = consultar<{ t: string; n: boolean }>(
      banco.conexao,
      `SELECT data_type AS t, is_nullable = 'YES' AS n FROM information_schema.columns
        WHERE table_schema = 'integracao_fdv' AND table_name = 'sinal' AND column_name = 'ultimo_codigo'`,
    );
    expect(c).toEqual({ t: 'text', n: true });
    const [n] = consultar<{ n: number }>(banco.conexao, 'SELECT count(*)::int AS n FROM integracao_fdv.sinal WHERE ultimo_codigo IS NOT NULL');
    expect(n?.n).toBe(0);
  });

  it('o worker grava mxi04, http_503 e de volta nulo no próprio tenant', () => {
    for (const v of ["'mxi04'", "'http_503'", 'NULL']) {
      expect(numeros(rodarComo(banco.conexao, gravar(v), COMO('macuxierp_worker', A)))).toEqual([1]);
    }
  });

  it('o CHECK recusa maiúscula, hífen, vazio e 81 caracteres (23514) e aceita 80', () => {
    for (const v of ["'MXI04'", "'http-503'", "''", "repeat('a', 81)"]) {
      recusaDetalhada(banco.conexao, gravar(v), '23514', /sinal_ultimo_codigo_check/, COMO('macuxierp_worker', A));
    }
    expect(numeros(rodarComo(banco.conexao, gravar("repeat('a', 80)"), COMO('macuxierp_worker', A)))).toEqual([1]);
  });

  it('o app não grava o código (42501)', () => {
    recusaDetalhada(banco.conexao, gravar("'mxi04'"), '42501', /permission denied/, COMO('macuxierp_app', A));
  });

  it('a 0073 roda de novo sem erro e sem mudar o CHECK', () => {
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    const [d] = consultar<{ def: string }>(
      banco.conexao,
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'sinal_ultimo_codigo_check'
          AND conrelid = 'integracao_fdv.sinal'::regclass`,
    );
    expect(d?.def).toBe("CHECK ((ultimo_codigo ~ '^[a-z0-9_]{1,80}$'::text))");
  });
});
