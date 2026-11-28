import { describe, expect, it } from 'vitest';
import { colunasDoModulo } from './comum';

describe('colunasDoModulo', () => {
  it('lê o tipo da coluna do descritor; status vira "Situação"', () => {
    const r = colunasDoModulo([{ id: 'quando', titulo: 'Quando', tipo: 'data' }, { id: 'ativo', titulo: 'Ativo', tipo: 'status' }, { id: 'nome', titulo: 'Nome' }]);
    expect(r).toEqual([{ id: 'quando', rotulo: 'Quando', tipo: 'data' }, { id: 'ativo', rotulo: 'Situação', tipo: 'status' }, { id: 'nome', rotulo: 'Nome' }]);
  });
  it('o mapa do 2º argumento sobrescreve o tipo da coluna', () => {
    const r = colunasDoModulo([{ id: 'a', titulo: 'A', tipo: 'data' }, { id: 'b', titulo: 'B' }], { a: 'texto', b: 'data' });
    expect(r.map((c) => c.tipo)).toEqual(['texto', 'data']);
  });
});
