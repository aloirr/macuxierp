/**
 * RN-CAD-15 (decisões 14 A e 17 B): o prazo médio vazio da condição de pagamento é calculado (média simples das parcelas, meio
 * para cima) e GRAVADO, no PostgreSQL real com RLS. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { corpoDoPatchDoPrazo, formularioDoPrazo } from '../web/prazos';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const gerente = sessaoDe('gerente');

describe.skipIf(!PG_DISPONIVEL)('RN-CAD-15: prazo médio efetivo gravado (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let T: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const amb = () => criarAmbiente(
    criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }),
    new Date('2026-11-25T15:00:00Z'), transacaoDe(app, T),
  );
  const medio = async (id: string) => (await admin('SELECT prazo_medio_dias FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]!.prazo_medio_dias as number | null;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    T = await criarTenant(efemero.admin, 'prazo-medio', ['cadastros']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('POST sem prazo médio grava a média; PATCH de parcelas com o prazo vazio no banco recalcula', async () => {
    const a = amb();
    const r = await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'PM1', descricao: 'D', forma_tpag: '15', prazos_dias: [30, 45] } });
    expect(r.status, JSON.stringify(r.corpo)).toBe(201);
    const id = (r.corpo as { id: string }).id;
    expect(await medio(id)).toBe(38);
    await admin('UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = NULL WHERE id = $1', [id]);
    expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazos_dias: [30, 60] } })).status).toBe(200);
    expect(await medio(id)).toBe(45);
  }, 120_000);

  it('decisão 17 B: PATCH de parcelas com a marca true recalcula e mantém true; com false mantém o digitado', async () => {
    const a = amb();
    const post = async (codigo: string, extra: object) =>
      ((await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo, descricao: 'D', forma_tpag: '15', prazos_dias: [30], ...extra } })).corpo as { id: string }).id;
    const calculado = await post('K1', {});
    const digitado = await post('K2', { prazo_medio_dias: 30 });
    const linha = async (id: string) => (await admin('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]!;
    expect(await linha(calculado)).toEqual({ prazo_medio_dias: 30, prazo_medio_calculado: true });
    expect(await linha(digitado)).toEqual({ prazo_medio_dias: 30, prazo_medio_calculado: false });
    for (const id of [calculado, digitado]) expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazos_dias: [30, 90] } })).status).toBe(200);
    expect(await linha(calculado)).toEqual({ prazo_medio_dias: 60, prazo_medio_calculado: true });
    expect(await linha(digitado)).toEqual({ prazo_medio_dias: 30, prazo_medio_calculado: false });
  }, 120_000);

  it('T-0108, 17 B: ida e volta da tela (formulário de um calculado, só as parcelas mudam, PATCH) mantém a marca true e recalcula', async () => {
    const a = amb();
    const post = await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'T108', descricao: 'D', forma_tpag: '15', prazos_dias: [30, 45] } });
    const id = (post.corpo as { id: string }).id;
    const original = (await a.chamar('GET', `/condicoes-pagamento/${id}`, { sessao: gerente })).corpo as Parameters<typeof formularioDoPrazo>[0];
    const form = formularioDoPrazo(original);
    expect(form).toMatchObject({ prazo_medio_dias: '', prazo_medio_sugerido: '38' });
    const { corpo } = corpoDoPatchDoPrazo({ ...form, parcelas: ['30', '90'] }, original);
    expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo })).status).toBe(200);
    expect((await admin('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]).toEqual({ prazo_medio_dias: 60, prazo_medio_calculado: true });
  }, 120_000);

  it('RN-CAD-15: PATCH com o corpo vazio num calculado responde 200 e não muda o prazo nem a marca', async () => {
    const a = amb();
    const id = ((await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'R1', descricao: 'D', forma_tpag: '15', prazos_dias: [30, 45] } })).corpo as { id: string }).id;
    expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: {} })).status).toBe(200);
    expect((await admin('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]).toEqual({ prazo_medio_dias: 38, prazo_medio_calculado: true });
  }, 120_000);

  it('RN-CAD-15: apagar o campo de um digitado (PATCH prazo_medio_dias null) grava o calculado com a marca true', async () => {
    const a = amb();
    const id = ((await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'R2', descricao: 'D', forma_tpag: '15', prazos_dias: [30, 45], prazo_medio_dias: 40 } })).corpo as { id: string }).id;
    expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazo_medio_dias: null } })).status).toBe(200);
    expect((await admin('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]).toEqual({ prazo_medio_dias: 38, prazo_medio_calculado: true });
  }, 120_000);

  it('T-0112, RN-CAD-15: POST com o prazo médio fora da faixa das parcelas dá 422 e nada é gravado', async () => {
    const a = amb();
    const r = await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'FX1', descricao: 'D', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 57 } });
    expect(r.status).toBe(422);
    expect((await admin("SELECT count(*)::int AS n FROM cadastros.condicao_pagamento WHERE codigo = 'FX1'"))[0]!.n).toBe(0);
  }, 120_000);
});
