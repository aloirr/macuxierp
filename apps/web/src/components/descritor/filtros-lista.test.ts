import { describe, expect, it } from 'vitest';
import { urlDosFiltros } from './filtros-lista';

describe('urlDosFiltros (RD-2382)', () => {
  it('leva só os filtros preenchidos, sem espaços nas pontas e sem cursor', () => {
    expect(urlDosFiltros('/pedido/pedidos', [['busca', ' 123 '], ['status', ''], ['filial_id', 'f1']])).toBe('/pedido/pedidos?busca=123&filial_id=f1');
  });
  it('tudo vazio volta à rota limpa', () => {
    expect(urlDosFiltros('/faturamento/notas', [['busca', '  '], ['de', '']])).toBe('/faturamento/notas');
  });
});
