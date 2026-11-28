import { describe, expect, it } from 'vitest';
import { colunasDosFiltros } from './lista';

const sel = (chave: string) => ({ tipo: 'selecao' as const, chave });
describe('colunasDosFiltros (RD-2383, grade de 24 avos = 12 colunas)', () => {
  it('Pedidos: Buscar 2, Status 1, Cliente 2, Vendedor 2, Filial 1, Origem 1, De e Até 1,5 cada = 12', () => {
    const r = colunasDosFiltros([{ tipo: 'busca' }, sel('status'), { tipo: 'cadastro', chave: 'cliente_id' }, { tipo: 'cadastro', chave: 'vendedor_id' }, { tipo: 'cadastro', chave: 'filial_id' }, sel('origem'), { tipo: 'data', chave: 'de' }, { tipo: 'data', chave: 'ate' }]);
    expect(r).toEqual([4, 2, 4, 4, 2, 2, 3, 3]);
  });
  it('sobra vira coluna dos selects (Notas: sem cliente/vendedor)', () => {
    const r = colunasDosFiltros([sel('status'), sel('ambiente'), { tipo: 'cadastro', chave: 'filial_id' }, { tipo: 'texto', chave: 'serie' }, { tipo: 'texto', chave: 'numero' }, { tipo: 'data', chave: 'de' }, { tipo: 'data', chave: 'ate' }]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(24);
    expect(r.slice(0, 3).every((n) => n >= 2)).toBe(true);
  });
  it('a dica colunas do descritor vale (x2) e sem filtro nada sai', () => {
    expect(colunasDosFiltros([{ tipo: 'texto', chave: 'x', colunas: 6 }, sel('y')])[0]).toBe(12);
    expect(colunasDosFiltros([])).toEqual([]);
  });
});
