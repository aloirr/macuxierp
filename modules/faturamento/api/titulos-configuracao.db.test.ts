/**
 * Bandeira por filial "faturamento real com NF-e simulada" contra o PostgreSQL real.
 * ATENÇÃO: este teste FALHA até o banco-dados criar `faturamento.configuracao_filial` (filial_id, faturamento_real_nfe_simulada, alterado_por; tenant_id,
 * id, created_at, updated_at, deleted_at, external_id, RLS; grants SELECT, INSERT, UPDATE para macuxierp_app). Fica em arquivo separado de propósito.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { uuid } from './apoio-teste';
import { configuracaoFaturamentoSql as repo } from './sql-configuracao';

describe.skipIf(!PG_DISPONIVEL)('configuração da filial (PostgreSQL real, tabela faturamento.configuracao_filial, ainda sem migração)', () => {
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

  it('RN-FAT-04: sem linha a bandeira é desligada; definir liga, desliga e grava quem alterou', async () => {
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, true, uuid(5)));
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(true);
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, false, uuid(6)));
    expect(await app.comTenant(A, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
    const linhas = (await efemero.admin.query('SELECT alterado_por FROM faturamento.configuracao_filial WHERE tenant_id = $1', [A])).rows;
    expect(linhas).toEqual([{ alterado_por: uuid(6) }]); // uma linha por filial, atualizada
  });

  it('RN-CORE-01: a configuração de um tenant não vale para o outro (RLS)', async () => {
    await app.comTenant(A, (tx) => repo.definir(tx, IDS.filial, true, uuid(5)));
    expect(await app.comTenant(B, (tx) => repo.faturamentoRealComNfeSimulada(tx, IDS.filial))).toBe(false);
  });
});
