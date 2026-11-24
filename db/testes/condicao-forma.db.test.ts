/**
 * T-0026 (D12): colunas forma_* em cadastros.condicao_pagamento (0010) e o índice (tenant_id, forma_external_id).
 * Limites do Hub (0051, T-0057): forma_external_id 200 e forma_codigo 30.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('forma-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };

/** Condição de prazo; sem forma = como a versão anterior da API grava (sem as colunas novas). */
const inserir = (tenant: string, codigo: string, forma: string | null): string =>
  forma === null
    ? `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, external_id)
       VALUES ('${tenant}', '${codigo}', 'Boleto 30', '15', '{30}', 'prazo-${codigo}');`
    : `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, external_id,
         forma_external_id, forma_codigo, forma_nome)
       VALUES ('${tenant}', '${codigo}', 'Boleto 30', '15', '{30}', 'prazo-${codigo}', '${forma}', 'BOLETO',
         'Boleto bancário');`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — forma de pagamento na condição (T-0026, 0010)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
  });

  afterAll(() => banco?.remover());

  it('as colunas forma_* existem, são texto anulável sem padrão e respeitam os tamanhos (D12: nome 60; 0051, T-0057: forma_external_id 200 e código 30)', () => {
    const colunas = consultar<{ c: string; tipo: string; nula: string; padrao: string | null }>(
      banco.conexao,
      `SELECT column_name AS c, data_type AS tipo, is_nullable AS nula, column_default AS padrao
       FROM information_schema.columns WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento'
         AND column_name LIKE 'forma\\_%' ORDER BY 1`,
    );
    expect(colunas).toEqual([
      { c: 'forma_codigo', tipo: 'text', nula: 'YES', padrao: null },
      { c: 'forma_external_id', tipo: 'text', nula: 'YES', padrao: null },
      { c: 'forma_nome', tipo: 'text', nula: 'YES', padrao: null },
      { c: 'forma_tpag', tipo: 'text', nula: 'NO', padrao: null },
    ]);

    // Sem as colunas novas (versão anterior da API) continua gravando.
    executar(banco.conexao, inserir(A.id, 'SEMFORMA', null), APP_A);
    executar(banco.conexao, inserir(A.id, 'B30', 'forma-boleto'), APP_A);

    const atualizar = (coluna: string, tamanho: number): string =>
      `UPDATE cadastros.condicao_pagamento SET ${coluna} = repeat('x', ${tamanho}) WHERE codigo = 'SEMFORMA';`;
    for (const [coluna, limite] of [
      ['forma_external_id', 200],
      ['forma_codigo', 30],
      ['forma_nome', 60],
    ] as const) {
      executar(banco.conexao, atualizar(coluna, limite), APP_A);
      expect(falha(() => executar(banco.conexao, atualizar(coluna, limite + 1), APP_A))).toMatch(
        /check constraint/,
      );
    }
  });

  it('o índice (tenant_id, forma_external_id) existe, não é único e serve à busca da forma', () => {
    const [ix] = consultar<{ def: string; unico: boolean }>(
      banco.conexao,
      `SELECT pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS unico FROM pg_index i
       WHERE i.indexrelid = 'cadastros.condicao_pagamento_forma_external_id_ix'::regclass`,
    );
    expect(ix?.unico).toBe(false);
    expect(ix?.def).toMatch(/\(tenant_id, forma_external_id\) WHERE \(forma_external_id IS NOT NULL\)/);

    // Várias condições da mesma forma no mesmo tenant (uma por prazo, D12).
    executar(banco.conexao, inserir(A.id, 'B3060', 'forma-boleto'), APP_A);
    const plano = rodarScript(
      banco.conexao,
      `SET enable_seqscan = off;
       EXPLAIN (COSTS OFF) SELECT id FROM cadastros.condicao_pagamento
         WHERE tenant_id = '${A.id}' AND forma_external_id = 'forma-boleto';`,
    );
    expect(plano).toMatch(/condicao_pagamento_forma_external_id_ix/);
  });
});
