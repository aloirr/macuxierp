/** Regressão da carga de 24/11 (RN-INF-02, M10): dependentes consumidos antes da filial e do produto são recompostos com a chave do Hub e saem confirmados; lote montado no voo da filial retém e sai depois do finalizar. */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { criarConsumidorPublicarCadastros } from './consumidor-cadastros';
import { mais } from './conector-comum';
import { AGORA, admSql, cadCliente, cadFilial, cadPreco, cadProduto, cadTabela, cadVendedor, ciclo, criarCredencial, evento, hubDuble, licenciadas, ok, U } from './apoio-conector-teste';
import { ENTIDADES_HUB_F2 } from '../contracts';
import type { EnvelopeEvento } from '@macuxierp/platform-sdk';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const consumidor = criarConsumidorPublicarCadastros({ licencas: licenciadas('integracao-fdv'), agora: () => AGORA });
const T = (m: number) => `2026-11-24T08:${String(m).padStart(2, '0')}:00.000Z`;

type LoteHub = { entidade: string; modo?: string; registros: Array<{ external_id: string }> };

describe.skipIf(!PG_DISPONIVEL)('regressão da carga de 24/11', { timeout: 60_000 }, () => {
  let efemero: BancoEfemero; let banco: BancoPg; let adm: ReturnType<typeof admSql>;
  beforeAll(async () => { efemero = await criarBancoEfemero(); adm = admSql(efemero); banco = efemero.banco('macuxierp_worker', 6); });
  afterAll(async () => { await efemero?.remover(); });
  const tratar = (t: string, e: EnvelopeEvento) => banco.comTenant(t, (tx) => consumidor.tratar(e, tx));
  const rows = (t: string) => adm('SELECT entidade, registro_external_id k, payload, pendente, hash, hash_confirmado FROM integracao_fdv.registro_publicado WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY entidade, registro_external_id', [t]);
  const lotes = (t: string) => adm('SELECT entidade, estado FROM integracao_fdv.lote_envio WHERE tenant_id=$1 ORDER BY created_at', [t]);
  const por = (rs: Awaited<ReturnType<typeof rows>>, entidade: string) => rs.filter((r) => r.entidade === entidade);
  const um = (rs: Awaited<ReturnType<typeof rows>>, entidade: string) => { const r = por(rs, entidade)[0]; if (!r) throw new Error(`sem registro ${entidade}`); return r; };

  // Hub que aceita tudo; com o gate fechado, o lote da filial fica em "processando".
  function hubGuardado(log: string[], gate: { aberto: boolean }, ausente?: { chave: string }) {
    const recebidos = new Map<string, LoteHub>();
    return hubDuble({
      ...Object.fromEntries(ENTIDADES_HUB_F2.map((e) => [`GET /cursores/${e}`, [ok({ entidade: e, cursor: null, atualizado_em: null }, false, 200)]])),
      'POST /sinal': [ok({}, false, 200)],
      'GET /pedidos/pendentes': [ok({ pedidos: [] }, false, 200)],
      'POST /lotes': [(p) => {
        const c = p.corpo as LoteHub; const id = U();
        recebidos.set(id, c); log.push(`POST ${c.entidade} n=${c.registros.length}`);
        return ok({ lote_id: id, status: 'recebido', entidade: c.entidade, modo: c.modo, recebidos: c.registros.length, repetido: false, consulta: `/integracao/v1/lotes/${id}` });
      }],
      'GET /lotes/{id}': [(p) => {
        const id = p.caminho.split('/').pop()!; const c = recebidos.get(id)!;
        const n = c.registros.length;
        if (!gate.aberto && c.entidade === 'filial') return ok({ lote_id: id, entidade: c.entidade, modo: c.modo ?? 'completo', status: 'processando', contagens: { recebidas: n, com_erro: 0, novas: 0 }, erros: [] }, false, 200);
        if (ausente && c.entidade === 'vendedor') {
          const chave = ausente.chave; ausente = undefined; // só o primeiro lote do vendedor é recusado
          return ok({ lote_id: id, entidade: c.entidade, modo: c.modo ?? 'delta', status: 'concluido_com_erros', contagens: { recebidas: n, com_erro: 1, novas: 0 }, erros: [{ indice: 0, external_id: chave, codigo: 'referencia_ausente', campo: 'filial_external_id', reprocessavel: false, origem: 'hub' }] });
        }
        return ok({ lote_id: id, entidade: c.entidade, modo: c.modo ?? 'delta', status: 'concluido', contagens: { recebidas: n, com_erro: 0, novas: n }, erros: [] });
      }],
    });
  }

  async function montar(slug: string) {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    await criarCredencial(efemero.admin, t);
    return t;
  }

  it('passos 1-4: dependentes antes da filial e do produto são recompostos com a chave do Hub e saem confirmados', async () => {
    const t = await montar('rep-a');
    const f = U(); const p = U(); const v = U(); const c = U(); const tab = U(); const pr = U(); const est = U(); const u = U();
    await tratar(t, evento(t, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-1' }), T(52)));
    await tratar(t, evento(t, 'cadastros.estoque.alterado@1', est, { filial_id: f, produto_id: p, quantidade: 5000 }, T(53)));
    await tratar(t, evento(t, 'cadastros.tabela_preco.alterada@1', tab, cadTabela(tab, { external_id: 'TAB-1' }), T(53)));
    await tratar(t, evento(t, 'cadastros.preco.alterado@1', pr, cadPreco(tab, f, p), T(54)));
    await tratar(t, evento(t, 'cadastros.cliente.alterado@1', c, cadCliente(c, f, { external_id: 'CLI-1', vendedor_id: v, tabela_preco_id: tab }), T(55)));
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-AM2808-01' }), T(57)));
    await tratar(t, evento(t, 'cadastros.produto.alterado@1', p, cadProduto(p, [{ id: u, unidade: 'CX', fator: 10000, ean: null }], { external_id: 'PRD-CARGA-1' }), T(58)));

    const antes = await rows(t);
    expect(um(antes, 'vendedor').payload.filial_external_id).toBe('FIL-AM2808-01');
    expect(um(antes, 'cliente').payload.filial_external_id).toBe('FIL-AM2808-01');
    expect(um(antes, 'estoque').payload.filial_external_id).toBe('FIL-AM2808-01');
    expect(um(antes, 'estoque').payload.deposito_external_id).toBe('FIL-AM2808-01');
    for (const e of ['estoque', 'preco', 'produto_unidade']) expect(um(antes, e).payload.produto_external_id).toBe('PRD-CARGA-1');
    expect(um(antes, 'preco').payload.tabela_external_id).toBe('TAB-1');

    const hub = hubGuardado([], { aberto: true });
    for (let i = 0; i < 12; i++) await ciclo(banco, agenda, hub, mais(AGORA, i * 10), [t]);

    const concluidos = await lotes(t);
    const ordem = concluidos.map((l) => l.entidade);
    expect(ordem[0]).toBe('filial');
    for (const e of ['estoque', 'preco', 'produto_unidade']) expect(ordem.indexOf(e)).toBeGreaterThan(ordem.indexOf('produto'));
    expect(ordem.indexOf('produto')).toBeGreaterThan(ordem.indexOf('filial'));
    expect(concluidos.every((l) => l.estado === 'concluido')).toBe(true);

    const final = await rows(t);
    expect(final).toHaveLength(8);
    for (const r of final) { expect(r.pendente).toBe(false); expect(r.hash_confirmado).toBe(r.hash); }
  });

  it('passo 5: lote montado no voo da filial retém os dependentes e sai depois do finalizar', async () => {
    const t = await montar('rep-b');
    const f = U(); const v = U(); const c = U();
    await tratar(t, evento(t, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-2' }), T(52)));
    await tratar(t, evento(t, 'cadastros.cliente.alterado@1', c, cadCliente(c, f, { external_id: 'CLI-2' }), T(52)));
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-AM2808-01' }), T(57)));
    const log: string[] = []; const gate = { aberto: false };
    const hub = hubGuardado(log, gate);
    for (let i = 0; i < 4; i++) await ciclo(banco, agenda, hub, mais(AGORA, i), [t]);

    expect(log).toEqual(['POST filial n=1']);
    expect(await lotes(t)).toEqual([{ entidade: 'filial', estado: 'aceito' }]);
    expect((await rows(t)).filter((r) => r.entidade !== 'filial').every((r) => r.pendente)).toBe(true);

    gate.aberto = true;
    for (let i = 0; i < 12; i++) await ciclo(banco, agenda, hub, mais(AGORA, 10 + i * 10), [t]);

    expect(log[0]).toBe('POST filial n=1');
    expect([...log].sort()).toEqual(['POST cliente n=1', 'POST cliente_endereco n=1', 'POST filial n=1', 'POST vendedor n=1']);
    expect((await lotes(t)).every((l) => l.estado === 'concluido')).toBe(true);
    const final = await rows(t);
    expect(final).toHaveLength(4);
    for (const r of final) { expect(r.pendente).toBe(false); expect(r.hash_confirmado).toBe(r.hash); }
  });

  it('RN-INF-02: referencia_ausente do Hub com reprocessavel false volta o registro e termina confirmado', async () => {
    const t = await montar('rep-c');
    const f = U(); const v = U();
    await tratar(t, evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-AM2808-01' }), T(50)));
    await tratar(t, evento(t, 'cadastros.vendedor.alterado@1', v, cadVendedor(v, f, { external_id: 'VEN-3' }), T(52)));
    const log: string[] = [];
    const hub = hubGuardado(log, { aberto: true }, { chave: 'VEN-3' });
    for (let i = 0; i < 14; i++) await ciclo(banco, agenda, hub, mais(AGORA, i * 300), [t]);

    expect(log.filter((l) => l.startsWith('POST vendedor'))).toHaveLength(2);
    const r = um(await rows(t), 'vendedor');
    expect(r.pendente).toBe(false);
    expect(r.hash_confirmado).toBe(r.hash);
    const erros = await adm('SELECT reprocessavel, resolvido_em FROM integracao_fdv.lote_erro WHERE tenant_id=$1 AND codigo=$2', [t, 'referencia_ausente']);
    expect(erros).toHaveLength(1);
    expect(erros[0]!.reprocessavel).toBe(true);
    expect(erros[0]!.resolvido_em).not.toBeNull();
  });
});
