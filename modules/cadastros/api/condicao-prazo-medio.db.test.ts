/**
 * RN-CAD-15 e decisão 14 A (T-0107): o prazo médio vazio da condição de pagamento é calculado (média simples das parcelas, meio
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

  it('POST sem prazo médio grava a média; PATCH que muda as parcelas com prazo vazio recalcula; prazo digitado fica', async () => {
    const a = amb();
    const base = { descricao: 'D', forma_tpag: '15' };
    const post = async (codigo: string, extra: object) => {
      const r = await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { ...base, codigo, ...extra } });
      expect(r.status, JSON.stringify(r.corpo)).toBe(201);
      return (r.corpo as { id: string }).id;
    };
    const patch = async (id: string, corpo: object) => expect((await a.chamar('PATCH', `/condicoes-pagamento/${id}`, { sessao: gerente, corpo })).status).toBe(200);

    const sem = await post('PM1', { prazos_dias: [30, 45] });
    expect(await medio(sem)).toBe(38);
    expect(await medio(await post('PM2', { prazos_dias: [28, 56, 84], prazo_medio_dias: null }))).toBe(56);
    const digitado = await post('PM3', { prazos_dias: [30, 60], prazo_medio_dias: 10 });
    expect(await medio(digitado)).toBe(10);
    expect(await medio(await post('PM4', { prazos_dias: [30, 60], prazo_medio_dias: 0 }))).toBe(0);

    // vazio no banco (legado) + parcelas mudam: recalcula
    await admin('UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = NULL WHERE id = $1', [sem]);
    await patch(sem, { prazos_dias: [30, 60] });
    expect(await medio(sem)).toBe(45);
    // digitado: o PATCH que muda as parcelas não sobrescreve
    await patch(digitado, { prazos_dias: [30, 90] });
    expect(await medio(digitado)).toBe(10);
  }, 120_000);
});
