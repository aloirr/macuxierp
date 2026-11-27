/**
 * T-0057, migração 0072: o macuxierp_worker grava o lote da /entrada/v1 (modules/cadastros/api/entrada-lote.ts) nos
 * cadastros com INSERT e UPDATE, sem DELETE; a RLS por tenant continua valendo (rls-worker-cadastros-0072.db.test.ts).
 * Motivo em docs/banco/README.md (0072).
 * Dados fictícios.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  criarBancoDeTeste,
  executar,
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0072_cadastros_grants_worker_entrada.sql', import.meta.url));
const A = novoTenant('grants-0072-a');
const B = novoTenant('grants-0072-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });
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

const inserirVendedor = (tenant: string, codigo: string) =>
  `INSERT INTO cadastros.vendedor (tenant_id, codigo, nome, filial_id)
   SELECT '${tenant}', '${codigo}', 'Vendedor ${codigo}', id FROM cadastros.filial WHERE tenant_id = '${tenant}' LIMIT 1;`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — worker grava o lote da /entrada/v1 nos cadastros (T-0057, 0072)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  const matriz = () => TABELAS.map((t) => privilegiosDe(banco.conexao, 'macuxierp_worker', t));

  it('o worker tem SELECT, INSERT e UPDATE nas tabelas do lote, sem DELETE nem TRUNCATE', () => {
    expect(matriz()).toEqual(TABELAS.map(() => 'SIU'));
  });

  it('o worker insere e atualiza o vendedor no próprio tenant', () => {
    rodarComo(banco.conexao, inserirVendedor(A.id, 'E72'), WORKER(A));
    const n = numeros(
      rodarComo(
        banco.conexao,
        `WITH u AS (UPDATE cadastros.vendedor SET nome = 'Vendedor novo', updated_at = now() WHERE codigo = 'E72' RETURNING 1)
         SELECT count(*) FROM u;`,
        WORKER(A),
      ),
    );
    expect(n).toEqual([1]);
  });

  it('DELETE continua negado ao worker (42501)', () => {
    recusaDetalhada(banco.conexao, 'DELETE FROM cadastros.vendedor;', '42501', /permission denied/, WORKER(A));
  });

  it('a 0072 roda de novo sem erro e sem ampliar nada', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(matriz()).toEqual(TABELAS.map(() => 'SIU'));
  });
});
