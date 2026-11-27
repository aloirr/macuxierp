/**
 * v0.3.18 (revisão do #766): RLS do macuxierp_worker nas 10 tabelas de cadastros que a 0072 abriu para INSERT e
 * UPDATE, com o tenant posto como o BancoPg do SDK (`set_config(..., true)`). Grants e DELETE:
 * grants-worker-entrada-0072.db.test.ts. Dados fictícios.
 */
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
  retratoDoTenant,
  rodarComo,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('rls-0072-a');
const B = novoTenant('rls-0072-b');
const WORKER = { papel: 'macuxierp_worker' };
const TABELAS = [
  'cadastros.vendedor',
  'cadastros.filial',
  'cadastros.condicao_pagamento',
  'cadastros.produto',
  'cadastros.produto_unidade',
  'cadastros.tabela_preco',
  'cadastros.tabela_preco_item',
  'cadastros.cliente',
  'cadastros.cliente_endereco',
  'cadastros.cliente_contato',
] as const;

/** Prefixo do worker: o tenant só na transação, como o BancoPg do SDK. `null` = sessão sem tenant. */
const comTenant = (tenant: string | null, sql: string): string =>
  (tenant === null ? '' : `SELECT set_config('app.tenant_id', '${tenant}', true) IS NULL;\n`) + sql;

const contar = (sql: string): number => numeros(sql).at(-1) ?? Number.NaN;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — RLS do worker nas tabelas de cadastros da 0072 (v0.3.18)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  /** Retrato das linhas do tenant, lido pelo admin (fora da RLS). */
  const retrato = (tabela: string, tenant: string): string => {
    const [esquema = '', nome = ''] = tabela.split('.');
    return retratoDoTenant(banco.conexao, tenant, [{ esquema, tabela: nome }])[tabela] ?? '';
  };

  /** INSERT de uma cópia da linha do A (lida pelo admin) com id novo e o tenant_id pedido. */
  const insercao = (tabela: string, tenant: string): string => {
    const [r] = consultar<{ j: string }>(
      banco.conexao,
      `SELECT (to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', '${tenant}'))::text AS j
       FROM ${tabela} t WHERE tenant_id = '${A.id}' LIMIT 1`,
    );
    const json = (r?.j ?? '').replaceAll("'", "''");
    return `INSERT INTO ${tabela} SELECT (jsonb_populate_record(NULL::${tabela}, '${json}'::jsonb)).*;`;
  };

  const ver = (tabela: string, tenant: string | null, filtro = 'true'): number =>
    contar(rodarComo(banco.conexao, comTenant(tenant, `SELECT count(*) FROM ${tabela} WHERE ${filtro};`), WORKER));

  const atualizar = (tabela: string, tenant: string | null, alvo: string): number =>
    contar(
      rodarComo(
        banco.conexao,
        comTenant(
          tenant,
          `WITH u AS (UPDATE ${tabela} SET external_id = 'cruzado-0072' WHERE tenant_id = '${alvo}' RETURNING 1)
           SELECT count(*) FROM u;`,
        ),
        WORKER,
      ),
    );

  it.each(TABELAS)('%s: (a) o worker do A lê só as linhas do A', (tabela) => {
    expect({ tabela, doA: ver(tabela, A.id) > 0, alheias: ver(tabela, A.id, `tenant_id <> '${A.id}'`) }).toEqual({
      tabela,
      doA: true,
      alheias: 0,
    });
  });

  it.each(TABELAS)('%s: (b) INSERT com o tenant_id do B dá 42501', (tabela) => {
    recusaDetalhada(banco.conexao, comTenant(A.id, insercao(tabela, B.id)), '42501', /row-level security/, WORKER);
  });

  it.each(TABELAS)('%s: (c) UPDATE na linha do B atinge 0 linhas e o B não muda', (tabela) => {
    const antes = retrato(tabela, B.id);
    expect({ tabela, comLinhas: /^[1-9]/.test(antes), atingidas: atualizar(tabela, A.id, B.id) }).toEqual({
      tabela,
      comLinhas: true,
      atingidas: 0,
    });
    expect({ tabela, depois: retrato(tabela, B.id) }).toEqual({ tabela, depois: antes });
  });

  it.each(TABELAS)('%s: (d) sem tenant na sessão, não lê nem grava nada', (tabela) => {
    const antes = retrato(tabela, A.id);
    expect({ tabela, lidas: ver(tabela, null), atingidas: atualizar(tabela, null, A.id) }).toEqual({
      tabela,
      lidas: 0,
      atingidas: 0,
    });
    recusaDetalhada(banco.conexao, insercao(tabela, A.id), '42501', /row-level security/, WORKER);
    expect({ tabela, depois: retrato(tabela, A.id) }).toEqual({ tabela, depois: antes });
  });
});
