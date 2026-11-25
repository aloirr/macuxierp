import { describe, expect, it } from 'vitest';
import { planoZeragemPedidos, type PedidoParaZerar } from './zeragem';

const ped = (id: string, o: Partial<PedidoParaZerar> = {}): PedidoParaZerar => ({ id, status: 'aprovado', origem: 'bko', com_nota: false, com_titulo: false, ...o });

describe('RN-CAD-10: zerar pedidos não faturados', () => {
  it('RN-CAD-10: pedido sem nota e sem título é apagado, em qualquer status não faturado', () => {
    const ps = (['recebido', 'em_analise', 'aprovado', 'recusado', 'cancelado'] as const).map((s) => ped(s, { status: s }));
    const r = planoZeragemPedidos(ps);
    expect(r.apagar).toEqual(['recebido', 'em_analise', 'aprovado', 'recusado', 'cancelado']);
    expect(r.mantidos).toEqual([]);
  });

  it('RN-CAD-10: pedido com nota fica (mantido por nota)', () => {
    const r = planoZeragemPedidos([ped('a', { com_nota: true }), ped('b')]);
    expect(r.apagar).toEqual(['b']);
    expect(r.mantidos).toEqual([{ motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-10: pedido com título fica (mantido por título)', () => {
    const r = planoZeragemPedidos([ped('a', { com_titulo: true })]);
    expect(r.apagar).toEqual([]);
    expect(r.mantidos).toEqual([{ motivo: 'titulo', quantidade: 1 }]);
  });

  it('RN-CAD-10: com nota e título, conta uma vez, como nota', () => {
    expect(planoZeragemPedidos([ped('a', { com_nota: true, com_titulo: true })]).mantidos).toEqual([{ motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-10: faturado e faturado parcial ficam mesmo sem a nota na porta (nota nunca é apagada)', () => {
    const r = planoZeragemPedidos([ped('a', { status: 'faturado' }), ped('b', { status: 'faturado_parcial' })]);
    expect(r.apagar).toEqual([]);
    expect(r.mantidos).toEqual([{ motivo: 'nota', quantidade: 2 }]);
  });

  it('RN-CAD-10: conta os apagados do FDV (só voltam pelo reenvio do FDV)', () => {
    const r = planoZeragemPedidos([ped('a', { origem: 'fdv' }), ped('b', { origem: 'bko' }), ped('c', { origem: 'fdv', com_nota: true })]);
    expect(r.apagar).toEqual(['a', 'b']);
    expect(r.apagarFdv).toBe(1);
  });

  it('RN-CAD-10: sem pedidos, plano vazio', () => {
    expect(planoZeragemPedidos([])).toEqual({ apagar: [], apagarFdv: 0, mantidos: [] });
  });
});
