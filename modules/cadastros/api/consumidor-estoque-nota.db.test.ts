/**
 * Consumidor de estoque das notas (T-0021) contra o PostgreSQL real, no papel macuxierp_app e com RLS: idempotência pelo
 * external_id do movimento e isolamento entre tenants. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { EnvelopeEvento, Outbox } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarConsumidorEstoqueNota, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_CANCELADA } from './consumidor-estoque-nota';
import { filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('consumidor de estoque das notas (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const ids: Record<string, { filial: string; produto: string }> = {};
  const publicados: EnvelopeEvento[] = [];
  const outbox: Outbox = { gravar: async (_tx, e) => publicados.push(e) };
  const consumidor = criarConsumidorEstoqueNota({ repositorios: repositoriosSql, outbox });
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;

  async function semear(tenant: string) {
    const a = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), new Date('2026-11-22T15:00:00Z'), transacaoDe(app, tenant));
    const adm = sessaoDe('administrador');
    const f = await a.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() });
    const p = await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300700', fator_tributavel: 10_000 }) });
    expect([f.status, p.status]).toEqual([201, 201]);
    return { filial: (f.corpo as { id: string }).id, produto: (p.corpo as { id: string }).id };
  }
  const nota = (t: { filial: string; produto: string }, extra: Record<string, unknown> = {}) => ({
    ambiente: 'producao', nota: { numero: 7, serie: 1 }, itens: [{ sequencia: 1, quantidade: 20_000, valor_centavos: 1, produto_id: t.produto, filial_id: t.filial }], ...extra,
  });
  const tratar = (tenant: string, id: string, payload: unknown, nome = EVENTO_NOTA_AUTORIZADA, notaId = '66666666-6666-4666-8666-666666666666') =>
    app.comTenant(tenant, (tx) => consumidor.tratar({ id, nome, tenant_id: tenant, agregado_id: notaId, versao: 1, ocorrido_em: '2026-11-22T15:00:00.000Z', ator: 'sistema', request_id: 'r', payload } as EnvelopeEvento, tx));
  const saldo = async (tenant: string) => (await admin('SELECT quantidade::float8 AS q FROM cadastros.estoque_saldo WHERE tenant_id = $1', [tenant])).map((l) => l.q as number);
  const movs = async (tenant: string) => admin('SELECT tipo, quantidade::float8 AS q, motivo, usuario_id FROM cadastros.estoque_movimento WHERE tenant_id = $1 ORDER BY created_at', [tenant]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'nota-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'nota-b', ['cadastros']);
    ids[A] = await semear(A);
    ids[B] = await semear(B);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-07: o mesmo evento duas vezes grava um movimento só; o saldo pode ficar negativo; a cancelada devolve', async () => {
    const ev = '55555555-5555-4555-8555-555555555551';
    await tratar(A, ev, nota(ids[A]!));
    await tratar(A, ev, nota(ids[A]!));
    expect(await saldo(A)).toEqual([-20_000]);
    expect(await movs(A)).toEqual([{ tipo: 'saida', q: 20_000, motivo: 'NF-e 7/1', usuario_id: null }]);
    expect(publicados).toHaveLength(1);
    await tratar(A, '55555555-5555-4555-8555-555555555552', nota(ids[A]!), EVENTO_NOTA_CANCELADA);
    expect(await saldo(A)).toEqual([0]);
    expect((await movs(A)).map((m) => m.tipo)).toEqual(['saida', 'entrada']);
  });

  it('RN-CAD-07: isolamento de tenant (o evento de A não mexe no estoque de B; produto de B sob A não grava)', async () => {
    expect(await saldo(B)).toEqual([]);
    await tratar(B, '55555555-5555-4555-8555-555555555553', nota(ids[B]!, { ambiente: 'homologacao' }));
    expect(await saldo(B)).toEqual([]);
    await tratar(B, '55555555-5555-4555-8555-555555555554', nota(ids[B]!, { ambiente: 'homologacao', conta_como_real: true }));
    expect(await saldo(B)).toEqual([-20_000]);
    expect(await saldo(A)).toEqual([0]);
    // produto e filial de B sob o tenant A: a RLS não os enxerga, o item é ignorado (log técnico) e nada grava
    await tratar(A, '55555555-5555-4555-8555-555555555555', nota(ids[B]!), EVENTO_NOTA_AUTORIZADA, '66666666-6666-4666-8666-666666666667');
    expect(await saldo(A)).toEqual([0]);
  });

  it('RN-CAD-07: outro id de evento para a mesma nota não move de novo; cancelada sem autorizada e produto inexistente não gravam', async () => {
    const t = ids[A]!;
    const n = '66666666-6666-4666-8666-666666666670';
    const antes = (await movs(A)).length;
    await tratar(A, '55555555-5555-4555-8555-555555555560', nota(t), EVENTO_NOTA_CANCELADA, n);
    expect((await movs(A)).length).toBe(antes);
    await tratar(A, '55555555-5555-4555-8555-555555555561', nota(t), EVENTO_NOTA_AUTORIZADA, n);
    await tratar(A, '55555555-5555-4555-8555-555555555562', nota(t), EVENTO_NOTA_AUTORIZADA, n);
    expect((await movs(A)).length).toBe(antes + 1);
    const o = await admin('SELECT origem_tipo, origem_id FROM cadastros.estoque_movimento WHERE tenant_id = $1 AND origem_id = $2', [A, n]);
    expect(o).toEqual([{ origem_tipo: 'nfe', origem_id: n }]);
    await tratar(A, '55555555-5555-4555-8555-555555555563', nota({ filial: t.filial, produto: '77777777-7777-4777-8777-777777777777' }), EVENTO_NOTA_AUTORIZADA, '66666666-6666-4666-8666-666666666671');
    expect((await movs(A)).length).toBe(antes + 1);
  });
});
