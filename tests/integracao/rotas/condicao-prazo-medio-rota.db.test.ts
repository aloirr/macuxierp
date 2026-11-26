/**
 * T-0108 (RN-CAD-15, decisões 14 A e 17 B): prazo médio da condição de pagamento pela ROTA de produção
 * (`/v1/cadastros/condicoes-pagamento`, `montarApiPg`), no Postgres com RLS, conferido pelo admin. Complementa os testes do
 * módulo (`condicao-prazo-medio.db.test.ts`, ambiente do plugin) e o e2e da rotina do worker (testes principal):
 * aqui entram a resposta da API (marca no corpo), o `null` explícito e o PATCH sem parcelas. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg } from '../../apoio/api-pg';

const ROTA = '/v1/cadastros/condicoes-pagamento';

describe.skipIf(!PG_DISPONIVEL)('T-0108: prazo médio calculado × digitado pela rota de produção (RN-CAD-15, decisões 14 A e 17 B)', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'A'>>>;
  const linha = async (id: string) =>
    (await api.b.admin.query('SELECT prazos_dias, prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id])).rows[0];
  const criar = async (codigo: string, extra: object) => {
    const r = await api.chamar('A', 'POST', ROTA, { codigo, descricao: `Prazo ${codigo}`, forma_tpag: '15', ...extra });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { id: string; prazo_medio_dias: number | null; prazo_medio_calculado?: boolean | null };
  };
  const alterar = async (id: string, corpo: object) => {
    const r = await api.chamar('A', 'PATCH', `${ROTA}/${id}`, corpo);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { prazo_medio_dias: number | null; prazo_medio_calculado?: boolean | null };
  };

  beforeAll(async () => {
    api = await montarApiPg({ A: ['cadastros'] });
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('decisão 14 A: POST sem prazo médio e com null calcula (30/45 → 38, 28/56/84 → 56) e grava a marca true; a resposta traz o mesmo', async () => {
    const sem = await criar('R1', { prazos_dias: [30, 45] });
    expect(sem).toMatchObject({ prazo_medio_dias: 38, prazo_medio_calculado: true });
    expect(await linha(sem.id)).toEqual({ prazos_dias: [30, 45], prazo_medio_dias: 38, prazo_medio_calculado: true });
    const nulo = await criar('R2', { prazos_dias: [28, 56, 84], prazo_medio_dias: null });
    expect(await linha(nulo.id)).toEqual({ prazos_dias: [28, 56, 84], prazo_medio_dias: 56, prazo_medio_calculado: true });
  });

  it('o digitado vale: POST com prazo médio grava o valor e a marca false, mesmo diferente da média', async () => {
    const c = await criar('R3', { prazos_dias: [30, 45], prazo_medio_dias: 20 });
    expect(c).toMatchObject({ prazo_medio_dias: 20, prazo_medio_calculado: false });
    expect(await linha(c.id)).toEqual({ prazos_dias: [30, 45], prazo_medio_dias: 20, prazo_medio_calculado: false });
  });

  it('PATCH sem parcelas não mexe; o de parcelas recalcula o calculado (marca na resposta); digitar troca a marca para false; null volta a calcular com true', async () => {
    const c = await criar('R6', { prazos_dias: [30, 60] });
    await alterar(c.id, { descricao: 'Prazo R6 renomeado' });
    expect(await linha(c.id)).toEqual({ prazos_dias: [30, 60], prazo_medio_dias: 45, prazo_medio_calculado: true });
    expect(await alterar(c.id, { prazos_dias: [30, 90] })).toMatchObject({ prazo_medio_dias: 60, prazo_medio_calculado: true });
    await alterar(c.id, { prazo_medio_dias: 50 });
    expect(await linha(c.id)).toEqual({ prazos_dias: [30, 90], prazo_medio_dias: 50, prazo_medio_calculado: false });
    await alterar(c.id, { prazo_medio_dias: null });
    expect(await linha(c.id)).toEqual({ prazos_dias: [30, 90], prazo_medio_dias: 60, prazo_medio_calculado: true });
  });
});
