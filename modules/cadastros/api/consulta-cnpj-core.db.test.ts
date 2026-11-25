/**
 * `ConsultaCnpjParaCore` (T-0101) contra o PostgreSQL real, dentro de UMA transação do tenant como o core usa: falha da fonte
 * vira valor e a tx segue usável; erro de banco sobe (não vira `fonte_indisponivel`).
 */
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import type { Transacao } from '@macuxierp/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarConsultaCnpjParaCore } from './consulta-cnpj-core';
import { BRASILAPI_CNPJ, CNPJ_A, fonte } from './fixtures-teste';
import { repositoriosSql } from './sql';
import type { Fontes } from './portas';

describe.skipIf(!PG_DISPONIVEL)('ConsultaCnpjParaCore (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  const AGORA = new Date('2026-11-24T14:00:00Z');
  const porta = (fontes: Fontes) => criarConsultaCnpjParaCore({ repositorios: repositoriosSql, fontes, relogio: { agora: () => AGORA } });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'empresa-a', ['cadastros']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RF-CAD-02: erro da fonte -> fonte_indisponivel e a transação continua usável', async () => {
    await app.comTenant(A, async (tx) => {
      const r = await porta({ cnpj: [fonte('brasilapi', new Error('timeout')), fonte('receita-aberta', new Error('502'))], cep: [] }).consultar(tx, A, CNPJ_A);
      expect(r).toEqual({ ok: false, motivo: 'fonte_indisponivel' });
      expect(await tx.consultar('SELECT 1 AS um')).toEqual([{ um: 1 }]); // não ficou "current transaction is aborted"
      const de = await porta({ cnpj: [fonte('brasilapi', BRASILAPI_CNPJ)], cep: [] }).consultar(tx, A, CNPJ_A);
      expect(de).toMatchObject({ ok: true, fonte: 'brasilapi' });
    });
  });

  it('erro de banco no cache sobe e não vira fonte_indisponivel', async () => {
    await app.comTenant(A, async (tx) => {
      const quebrada: Transacao = {
        consultar: <L>(sql: string, p: readonly unknown[] = []) =>
          sql.includes('consulta_externa') ? tx.consultar<L>('SELECT * FROM cadastros.tabela_que_nao_existe') : tx.consultar<L>(sql, p),
      };
      await expect(porta({ cnpj: [fonte('brasilapi', BRASILAPI_CNPJ)], cep: [] }).consultar(quebrada, A, CNPJ_A)).rejects.toThrow();
    });
  });
});
