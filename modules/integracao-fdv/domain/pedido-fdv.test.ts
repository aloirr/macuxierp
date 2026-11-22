import { describe, expect, it } from 'vitest';
import { PedidoParaErpLido } from '../contracts';
import { paraQtd4, traduzirPedido, type Espelho } from './pedido-fdv';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = {
  pedido_uuid: U(1), cliente_external_id: U(2), vendedor_external_id: U(3),
  criado_em: '2026-11-21T14:00:00-04:00', aprovado_em: '2026-11-21T14:05:00.000Z', observacao: 'obs', total_cents: 2500,
  itens: [{ sequencia: 1, produto_external_id: U(4), quantidade: 2.5, unidade: 'CX', fator: 1, quantidade_venda: 2.5,
    preco_unitario_cents: 1000, desconto_cents: 0, total_cents: 2500, aplicacao: null, campo_novo_do_hub: 1 }],
};
const espelho: Espelho = {
  clientes: new Set([U(2)]), vendedores: new Set([U(3)]), produtos: new Set([U(4)]), filialPadraoId: U(9),
  condicaoPorCodigo: new Map([['30D', U(7)]]), condicoes: new Set([U(8)]),
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
    const r = traduzirPedido(lido(), espelho);
    expect(r.ok && r.entrada.pedido_uuid).toBe(U(1));
    expect(r.ok && r.entrada.emitido_em).toBe('2026-11-21T18:00:00.000Z');
  });
  it('RN-PED-01: quantidade vira Qtd4 e dinheiro segue em centavos inteiros', () => {
    const r = traduzirPedido(lido(), espelho);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entrada.itens[0]).toMatchObject({ quantidade: 25_000, fator_venda: 10_000, preco_unitario_centavos: 1000, total_informado_centavos: 2500 });
    expect(r.entrada.total_informado_centavos).toBe(2500);
  });
  it('RN-PED-01: quantidade decimal em texto não passa por float de exibição', () => {
    expect(paraQtd4('0.0001')).toBe(1);
    expect(paraQtd4('1.1')).toBe(11_000);
    expect(paraQtd4(0)).toBeNull();
  });
  it('RN-PED-01: sem filial no pedido usa a filial padrão; com ela, a do pedido', () => {
    const a = traduzirPedido(lido(), espelho);
    expect(a.ok && a.entrada.filial_id).toBe(U(9));
    const b = traduzirPedido(lido({ filial: { external_id: U(5) } }), espelho);
    expect(b.ok && b.entrada.filial_id).toBe(U(5));
    expect(traduzirPedido(lido(), { ...espelho, filialPadraoId: null })).toEqual({ ok: false, codigo: 'filial_desconhecida' });
  });
  it('RN-INF-05: cliente, vendedor ou produto fora do espelho confirmado rejeitam o pedido', () => {
    expect(traduzirPedido(lido(), { ...espelho, clientes: new Set() })).toEqual({ ok: false, codigo: 'cliente_desconhecido' });
    expect(traduzirPedido(lido(), { ...espelho, vendedores: new Set() })).toEqual({ ok: false, codigo: 'vendedor_desconhecido' });
    expect(traduzirPedido(lido(), { ...espelho, produtos: new Set() })).toEqual({ ok: false, codigo: 'produto_desconhecido' });
  });
  it('RN-PED-01: sequência repetida rejeita', () => {
    const item = base.itens[0];
    expect(traduzirPedido(lido({ itens: [item, item] }), espelho)).toEqual({ ok: false, codigo: 'sequencia_repetida' });
  });
  it('RN-PED-01: condição pelo UUID do prazo, senão pelo código do ERP, senão nula', () => {
    const a = traduzirPedido(lido({ pagamento: { prazo_external_id: U(8) } }), espelho);
    expect(a.ok && a.entrada.condicao_pagamento_id).toBe(U(8));
    const b = traduzirPedido(lido({ pagamento: { condicao_pagamento_erp: '30D' } }), espelho);
    expect(b.ok && b.entrada.condicao_pagamento_id).toBe(U(7));
    const c = traduzirPedido(lido(), espelho);
    expect(c.ok && c.entrada.condicao_pagamento_id).toBeNull();
  });
});
