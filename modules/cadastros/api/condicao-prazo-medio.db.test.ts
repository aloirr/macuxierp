/**
 * RN-CAD-15 (decisões 14 A e 17 B): o prazo médio vazio da condição de pagamento é calculado (média simples das parcelas, meio
 * para cima) e GRAVADO, no PostgreSQL real com RLS. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('decisão 17 B (0068): PATCH de parcelas com a marca true recalcula e mantém true; com false mantém o digitado', async (ctx) => {
    const comMarca = (await admin("SELECT 1 FROM information_schema.columns WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento' AND column_name = 'prazo_medio_calculado'")).length > 0;
    if (!comMarca) return ctx.skip();
    const a = amb();
    const post = async (codigo: string, extra: object) =>
      ((await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo, descricao: 'D', forma_tpag: '15', prazos_dias: [30], ...extra } })).corpo as { id: string }).id;
    const calculado = await post('K1', {});
    const digitado = await post('K2', { prazo_medio_dias: 12 });
    const linha = async (id: string) => (await admin('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]!;
    expect(await linha(calculado)).toEqual({ prazo_medio_dias: 30, prazo_medio_calculado: true });
    expect(await linha(digitado)).toEqual({ prazo_medio_dias: 12, prazo_medio_calculado: false });
    for (const id of [calculado, digitado]) expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo: { prazos_dias: [30, 90] } })).status).toBe(200);
    expect(await linha(calculado)).toEqual({ prazo_medio_dias: 60, prazo_medio_calculado: true });
    expect(await linha(digitado)).toEqual({ prazo_medio_dias: 12, prazo_medio_calculado: false });
  }, 120_000);
});
