/**
 * Bandeira por filial "faturamento real com NF-e simulada" contra o PostgreSQL real (`faturamento.configuracao_filial`, migração 0026).
 * O histórico é gravado só pelo gatilho do banco; o adaptador não escreve nele. Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { uuid } from './apoio-teste';
import { configuracaoFaturamentoSql as repo } from './sql-configuracao';

describe.skipIf(!PG_DISPONIVEL)('configuração da filial (PostgreSQL real, tabela faturamento.configuracao_filial, 0026)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'fat-config-a', ['faturamento']);
    B = await criarTenant(efemero.admin, 'fat-config-b', ['faturamento']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FAT-04: definir é UPSERT: gravações simultâneas na mesma filial não dão 23505 e ficam com uma linha só', async () => {
    const T = await criarTenant(efemero.admin, 'fat-config-conc', ['faturamento']);
    await Promise.all([
      app.comTenant(T, (tx) => repo.definir(tx, IDS.filial, true, uuid(5))),
      app.comTenant(T, (tx) => repo.definir(tx, IDS.filial, false, uuid(6))),
      app.comTenant(T, (tx) => repo.definir(tx, IDS.filial, true, uuid(7))),
    ]);
    const n = (await efemero.admin.query('SELECT count(*)::int AS n FROM faturamento.configuracao_filial WHERE tenant_id = $1', [T])).rows[0].n;
    expect(n).toBe(1);
    const h = (await efemero.admin.query('SELECT count(*)::int AS n FROM faturamento.configuracao_filial_historico WHERE tenant_id = $1', [T])).rows[0].n;
    expect(h).toBe(3); // o gatilho grava uma linha por escrita, mesmo simultânea
  });

  it('RN-FAT-04: sem linha a bandeira é desligada; definir liga, desliga e grava quem alterou', async () => {
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, true, uuid(5)));
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(true);
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, false, uuid(6)));
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
    const linhas = (await efemero.admin.query('SELECT alterado_por FROM faturamento.configuracao_filial WHERE tenant_id = $1', [A])).rows;
    expect(linhas).toEqual([{ alterado_por: uuid(6) }]); // uma linha por filial, atualizada
  });

  it('RN-FAT-04: cada mudança na configuração gera exatamente 1 linha no histórico, gravada pelo gatilho', async () => {
    const T = await criarTenant(efemero.admin, 'fat-config-h', ['faturamento']);
    const hist = async () => (await efemero.admin.query('SELECT valor_anterior, valor_novo, alterado_por FROM faturamento.configuracao_filial_historico WHERE tenant_id = $1 ORDER BY alterado_em, id', [T])).rows;
    await app.comTenant(T, (tx) => repo.definir(tx, IDS.filial, true, uuid(5)));
    expect(await hist()).toEqual([{ valor_anterior: null, valor_novo: true, alterado_por: uuid(5) }]);
    await app.comTenant(T, (tx) => repo.definir(tx, IDS.filial, false, uuid(6)));
    expect(await hist()).toEqual([
      { valor_anterior: null, valor_novo: true, alterado_por: uuid(5) },
      { valor_anterior: true, valor_novo: false, alterado_por: uuid(6) },
    ]);
  });

  it('RN-CORE-01: a configuração de um tenant não vale para o outro (RLS)', async () => {
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, true, uuid(5)));
    expect(await app.comTenant(B, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
  });
});
