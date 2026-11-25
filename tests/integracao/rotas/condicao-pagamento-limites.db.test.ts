/**
 * P-15 (v0.3.12, #582): limite do prazo de pagamento pela ROTA de produção (`POST /v1/cadastros/condicoes-pagamento`,
 * `montarModulos` com os adaptadores SQL, `tests/apoio/api-pg.ts`), no Postgres. RN-CAD-09 e RN-CAD-15: no máximo
 * `MAX_PARCELAS` (24) parcelas, cada uma de 0 a `MAX_DIAS` (365) dias, e prazo médio de 0 a 365. Fora do limite = 400
 * com o campo, e nada gravado (conferido pelo admin, fora da RLS). No limite exato = 201, gravado. Dados fictícios.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DIAS, MAX_PARCELAS } from '../../../modules/cadastros/contracts';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg } from '../../apoio/api-pg';

const ROTA = '/v1/cadastros/condicoes-pagamento';
const lista = (n: number, dias: number): number[] => Array.from({ length: n }, () => dias);
const corpo = (codigo: string, prazos_dias: number[], prazo_medio_dias: number) => ({
  codigo,
  descricao: `Prazo ${codigo}`,
  forma_tpag: '15',
  prazos_dias,
  prazo_medio_dias,
  external_id: `PZ-P15-${codigo}`,
});

describe.skipIf(!PG_DISPONIVEL)(
  'P-15: limite 365 dias e 24 parcelas na rota da condição de pagamento (RN-CAD-09, RN-CAD-15)',
  () => {
    let api: Awaited<ReturnType<typeof montarApiPg<'A'>>>;
    const gravadas = async (codigo: string) =>
      (
        await api.b.admin.query<{ prazos_dias: number[]; prazo_medio_dias: number }>(
          'SELECT prazos_dias, prazo_medio_dias FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND codigo = $2',
          [api.t.A, codigo],
        )
      ).rows;

    beforeAll(async () => {
      api = await montarApiPg({ A: ['cadastros'] });
    }, 180_000);
    afterAll(async () => {
      await api?.fechar();
    });

    it.each([
      ['uma parcela de 366 dias', 'D366', [30, MAX_DIAS + 1], 200, /^prazos_dias/],
      ['25 parcelas', 'P25', lista(MAX_PARCELAS + 1, 30), 30, /^prazos_dias$/],
      ['prazo médio 366', 'M366', [30, 60], MAX_DIAS + 1, /^prazo_medio_dias$/],
    ])('%s → 400 VALIDACAO com o campo, e nada gravado', async (_n, codigo, prazos, medio, campo) => {
      const r = await api.chamar('A', 'POST', ROTA, corpo(codigo, prazos, medio));
      expect(r.statusCode, r.body).toBe(400);
      const e = r.json<{ codigo: string; campos?: Record<string, string> }>();
      expect(e.codigo).toBe('VALIDACAO');
      expect(
        Object.keys(e.campos ?? {}).some((k) => campo.test(k)),
        r.body,
      ).toBe(true);
      expect(await gravadas(codigo)).toEqual([]);
    });

    it('no limite: 24 parcelas de 365 dias com prazo médio 365 → 201, gravado como enviado', async () => {
      const prazos = lista(MAX_PARCELAS, MAX_DIAS);
      const r = await api.chamar('A', 'POST', ROTA, corpo('L24', prazos, MAX_DIAS));
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json()).toMatchObject({ codigo: 'L24', prazos_dias: prazos, prazo_medio_dias: MAX_DIAS });
      expect(await gravadas('L24')).toEqual([{ prazos_dias: prazos, prazo_medio_dias: MAX_DIAS }]);
    });
  },
);
