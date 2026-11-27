/**
 * T-0108 (v0.3.16), migração 0068: cadastros.condicao_pagamento.prazo_medio_calculado (default false) e UPDATE por
 * coluna ao worker (prazo_medio_dias, prazo_medio_calculado e updated_at). Motivo em docs/banco/README.md (0068).
 * Dados fictícios.
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
  privilegiosDe,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, inserirCondicao, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0068_cadastros_condicao_prazo_calculado.sql', import.meta.url));
const CP = 'cadastros.condicao_pagamento';
const A = novoTenant('condicao-0068-a');
const B = novoTenant('condicao-0068-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });

let banco: BancoDeTeste;
const um = <T,>(sql: string, ctx?: Parameters<typeof consultar>[2]): T => consultar<T>(banco.conexao, sql, ctx)[0] as T;
/** UPDATE do worker no prazo P30 do tenant `t`, contando as linhas atingidas. */
const atualizar = (t: Tenant, ctx = WORKER(t)): number[] =>
  numeros(
    rodarComo(
      banco.conexao,
      `WITH u AS (UPDATE ${CP} SET prazo_medio_dias = 30, prazo_medio_calculado = true, updated_at = now()
         WHERE tenant_id = '${t.id}' AND codigo = 'P30' RETURNING 1) SELECT count(*) FROM u;`,
      ctx,
    ),
  );
const prazo = (t: Tenant) =>
  um<{ dias: number | null; calc: boolean }>(
    `SELECT prazo_medio_dias AS dias, prazo_medio_calculado AS calc FROM ${CP} WHERE tenant_id = '${t.id}' AND codigo = 'P30'`,
  );

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — prazo médio calculado na condição (T-0108, 0068)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + inserirCondicao(t.id, 'P30', '15', 'NULL')).join('\n'),
    );
  });

  afterAll(() => banco?.remover());

  it('a coluna é boolean NOT NULL DEFAULT false e a linha existente sai false', () => {
    expect(
      um(`SELECT data_type AS tipo, is_nullable AS nula, column_default AS padrao FROM information_schema.columns
           WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento' AND column_name = 'prazo_medio_calculado'`),
    ).toEqual({ tipo: 'boolean', nula: 'NO', padrao: 'false' });
    expect([prazo(A), prazo(B)]).toEqual([
      { dias: null, calc: false },
      { dias: null, calc: false },
    ]);
  });

  it('o worker tem SELECT, INSERT e UPDATE na condição (0072); a leitura só SELECT', () => {
    expect(privilegiosDe(banco.conexao, 'macuxierp_worker', CP)).toBe('SIU');
    expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', CP)).toBe('S');
  });

  it('o worker grava as 3 colunas no próprio tenant', () => {
    expect(atualizar(A)).toEqual([1]);
    expect(prazo(A)).toEqual({ dias: 30, calc: true });
  });

  it('RLS: o worker do A atinge 0 linhas no B; o B não muda', () => {
    const antes = prazo(B);
    expect(atualizar(B, WORKER(A))).toEqual([0]);
    expect(prazo(B)).toEqual(antes);
  });

  it('a 0068 é reexecutável: rodar de novo não muda dado, coluna, privilégio nem comentário', () => {
    const r = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT jsonb_agg(jsonb_build_object('t', tenant_id, 'd', prazo_medio_dias, 'c', prazo_medio_calculado) ORDER BY id)
                   FROM ${CP}) AS dados,
                (SELECT count(*)::int FROM information_schema.columns
                  WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento') AS colunas,
                (SELECT relacl::text FROM pg_class WHERE oid = '${CP}'::regclass) AS acl,
                (SELECT string_agg(attname || '=' || attacl::text, ',' ORDER BY attnum) FROM pg_attribute
                  WHERE attrelid = '${CP}'::regclass AND attacl IS NOT NULL) AS acl_colunas,
                col_description('${CP}'::regclass,
                  (SELECT attnum FROM pg_attribute WHERE attrelid = '${CP}'::regclass AND attname = 'prazo_medio_calculado')::int) AS comentario`,
      );
    const antes = r();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(r()).toEqual(antes);
  });
});
