import { describe, expect, it } from 'vitest';

describe('colunasDosFiltros (RD-2383)', () => {
  it('cabe numa linha: busca 3 + 3 selects + 2 datas = 3+2+2+2+2+2 já corta os selects primeiro', async () => {
    const { colunasDosFiltros } = await import('./lista');
    expect(colunasDosFiltros(['busca', 'selecao', 'data', 'data'])).toEqual([3, 2, 2, 2]);
    expect(colunasDosFiltros(['busca', 'selecao', 'selecao', 'selecao', 'data', 'data'])).toEqual([3, 1, 1, 1, 2, 2]);
    expect(colunasDosFiltros([])).toEqual([]);
  });
});
