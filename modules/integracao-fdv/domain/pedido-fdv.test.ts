import { describe, expect, it } from 'vitest';
import { PedidoParaErpLido } from '../contracts';
import { chavesParaResolver, paraQtd4, traduzirPedido, type ChavesResolvidas } from './pedido-fdv';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = {
  pedido_uuid: U(1), cliente_external_id: U(2), vendedor_external_id: U(3),
  criado_em: '2026-11-21T14:00:00-04:00', aprovado_em: '2026-11-21T14:05:00.000Z', observacao: 'obs', total_cents: 2500,
  itens: [{ sequencia: 1, produto_external_id: U(4), quantidade: 2.5, unidade: 'CX', fator: 1, quantidade_venda: 2.5,
    preco_unitario_cents: 1000, desconto_cents: 0, total_cents: 2500, aplicacao: null, campo_novo_do_hub: 1 }],
};
// Chave do kit (external_id do sistema antigo) e UUID do ERP, os dois resolvidos pela porta para o UUID do ERP.
const KIT = 'C000123';
const chaves: ChavesResolvidas = {
  cliente: new Map([[U(2), U(12)], [KIT, U(22)]]),
  vendedor: new Map([[U(3), U(13)]]),
  filial: new Map([[U(5), U(15)]]),
  produto: new Map([[U(4), U(14)]]),
  prazo_pagamento: new Map([[U(8), U(18)]]),
  cliente_endereco: new Map([[U(6), U(16)]]),
  filialPadraoId: U(9),
};
const lido = (o: Record<string, unknown> = {}) => PedidoParaErpLido.parse({ ...base, ...o });

describe('PedidoParaErpLido (leitor tolerante do Hub)', () => {
  it('RN-PED-01: aceita campo novo do Hub sem derrubar o pedido', () => {
    expect(lido({ novo: 1 }).pedido_uuid).toBe(U(1));
  });
  it('RN-PED-01: pedido sem itens ou com uuid inválido fica fora do contrato', () => {
    expect(PedidoParaErpLido.safeParse({ ...base, itens: [] }).success).toBe(false);
    expect(PedidoParaErpLido.safeParse({ ...base, pedido_uuid: 'x' }).success).toBe(false);
  });
});

describe('traduzirPedido (T-0013 §5.2)', () => {
  it('RN-PED-01: pedido_uuid segue como identidade e o instante vai em UTC', () => {
    const r = traduzirPedido(lido(), chaves);
    expect(r.ok && r.entrada.pedido_uuid).toBe(U(1));
    expect(r.ok && r.entrada.emitido_em).toBe('2026-11-21T18:00:00.000Z');
  });
  it('RN-PED-01: quantidade vira Qtd4 e dinheiro segue em centavos inteiros', () => {
    const r = traduzirPedido(lido(), chaves);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entrada.itens[0]).toMatchObject({ quantidade: 25_000, fator_venda: 10_000, preco_unitario_centavos: 1000, total_informado_centavos: 2500 });
    expect(r.entrada.total_informado_centavos).toBe(2500);
  });
  it('RN-PED-01: quantidade decimal em texto não passa por float de exibição', () => {
    expect(paraQtd4('0.0001')).toBe(1);
    expect(paraQtd4('1.1')).toBe(11_000);
    expect(paraQtd4(0)).toBeNull();
  });
  it('RN-PED-01: sem filial no pedido usa a filial padrão; com ela, a resolvida pela porta', () => {
    const a = traduzirPedido(lido(), chaves);
    expect(a.ok && a.entrada.filial_id).toBe(U(9));
    const b = traduzirPedido(lido({ filial: { external_id: U(5) } }), chaves);
    expect(b.ok && b.entrada.filial_id).toBe(U(15));
    expect(traduzirPedido(lido({ filial: null }), chaves)).toMatchObject({ ok: true });
    expect(traduzirPedido(lido(), { ...chaves, filialPadraoId: null })).toEqual({ ok: false, codigo: 'filial_inexistente' });
  });
  it('RN-PED-01 e ADR 0010: chave do kit (external_id) e UUID do ERP viram o UUID do ERP', () => {
    const kit = traduzirPedido(lido({ cliente_external_id: KIT }), chaves);
    expect(kit.ok && kit.entrada.cliente_id).toBe(U(22));
    const erp = traduzirPedido(lido(), chaves);
    if (!erp.ok) throw new Error('esperava ok');
    expect(erp.entrada).toMatchObject({ cliente_id: U(12), vendedor_id: U(13) });
    expect(erp.entrada.itens[0]!.produto_id).toBe(U(14));
  });
  it('RN-INF-05: chave desconhecida de cada entidade rejeita com o código *_inexistente', () => {
    expect(traduzirPedido(lido(), { ...chaves, cliente: new Map() })).toEqual({ ok: false, codigo: 'cliente_inexistente' });
    expect(traduzirPedido(lido(), { ...chaves, vendedor: new Map() })).toEqual({ ok: false, codigo: 'vendedor_inexistente' });
    expect(traduzirPedido(lido(), { ...chaves, produto: new Map() })).toEqual({ ok: false, codigo: 'produto_inexistente' });
    expect(traduzirPedido(lido({ filial: { external_id: U(6) } }), chaves)).toEqual({ ok: false, codigo: 'filial_inexistente' });
    expect(traduzirPedido(lido({ pagamento: { prazo_external_id: U(6) } }), chaves)).toEqual({ ok: false, codigo: 'condicao_inexistente' });
  });
  it('RN-PED-01: frete e endereço do Hub entram no formato do contrato do pedido (CIF/FOB; retrato digitado)', () => {
    const r = traduzirPedido(lido({ frete: { modalidade: 'FOB', transportadora: { nome: 'T' } }, endereco_entrega: { logradouro: 'Rua A' } }), chaves);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entrada.frete).toEqual({ modalidade: 'FOB', transportadora: { nome: 'T' } });
    expect(r.entrada.endereco_entrega).toEqual({ endereco_id: null, retrato: { logradouro: 'Rua A' } });
  });
  it('RN-PED-01: frete com modalidade fora de CIF/FOB não entra', () => {
    const r = traduzirPedido(lido({ frete: { modalidade: 'XYZ' } }), chaves);
    expect(r.ok && r.entrada.frete).toBeNull();
  });
  it('RN-PED-01: sequência repetida rejeita', () => {
    const item = base.itens[0];
    expect(traduzirPedido(lido({ itens: [item, item] }), chaves)).toEqual({ ok: false, codigo: 'sequencia_repetida' });
  });
  it('RN-PED-01: condição pela chave do prazo; sem prazo vira null (a porta recusa com condicao_ausente) e nunca procura por código', () => {
    const a = traduzirPedido(lido({ pagamento: { prazo_external_id: U(8) } }), chaves);
    expect(a.ok && a.entrada.condicao_pagamento_id).toBe(U(18));
    const c = traduzirPedido(lido({ pagamento: { condicao_pagamento_erp: '30D' } }), chaves);
    expect(c.ok && c.entrada.condicao_pagamento_id).toBeNull();
  });
  it('RN-INF-05: chavesParaResolver pede uma lista por entidade, sem repetir produto e sem filial ausente', () => {
    const item = base.itens[0]!;
    expect(chavesParaResolver(lido({ itens: [item, { ...item, sequencia: 2 }] }))).toEqual({
      cliente: [U(2)], vendedor: [U(3)], filial: [], produto: [U(4)], prazo_pagamento: [], cliente_endereco: [],
    });
    expect(chavesParaResolver(lido({ filial: { external_id: U(5) }, pagamento: { prazo_external_id: U(8) } }))).toMatchObject({ filial: [U(5)], prazo_pagamento: [U(8)] });
  });
  it('ADR 0010: endereço de entrega origem erp achado pela porta preenche endereco_id; não achado fica null, com retrato e sem rejeitar', () => {
    const entrega = (external_id: string) => lido({ endereco_entrega: { origem: 'erp', external_id, logradouro: 'Rua A' } });
    expect(chavesParaResolver(entrega(U(6))).cliente_endereco).toEqual([U(6)]);
    expect(chavesParaResolver(lido({ endereco_entrega: { origem: 'digitado', external_id: U(6) } })).cliente_endereco).toEqual([]);
    // A-01 (T-0017): origem ausente vale 'erp'; external_id nulo ou vazio = só os textos
    expect(chavesParaResolver(lido({ endereco_entrega: { external_id: U(6), principal: false } })).cliente_endereco).toEqual([U(6)]);
    expect(chavesParaResolver(lido({ endereco_entrega: { external_id: null, logradouro: 'Rua A' } })).cliente_endereco).toEqual([]);
    const semOrigem = traduzirPedido(lido({ endereco_entrega: { external_id: U(6), principal: false } }), chaves);
    expect(semOrigem.ok && semOrigem.entrada.endereco_entrega).toMatchObject({ endereco_id: U(16) });
    const achado = traduzirPedido(entrega(U(6)), chaves);
    expect(achado.ok && achado.entrada.endereco_entrega).toMatchObject({ endereco_id: U(16), retrato: { logradouro: 'Rua A' } });
    const naoAchado = traduzirPedido(entrega(U(7)), chaves);
    expect(naoAchado.ok && naoAchado.entrada.endereco_entrega).toMatchObject({ endereco_id: null, retrato: { logradouro: 'Rua A' } });
  });
});
