import { describe, expect, it } from 'vitest';
import { verificarFracaoDosItens } from './fracao';

describe('RN-CAD-17: fração só em KG e M no pedido', () => {
  it('RN-CAD-17: a violação aponta o código da regra e o campo itens[N].quantidade do item fracionado', () => {
    const v = verificarFracaoDosItens([{ produto_id: 'p1', quantidade: 10_000 }, { produto_id: 'p1', quantidade: 10_500 }], () => 'UN');
    expect(v).toEqual([{ rn: 'RN-CAD-17', campo: 'itens[1].quantidade', mensagem: expect.stringContaining('KG e M') }]);
  });
});
