import { describe, expect, it } from 'vitest';
import { totalItem, valorItem, verificarItens } from './valores';

describe('valor do item', () => {
  it('RN-CORE-03: valor = qtd4 × preço / 10⁴ com meio para cima', () => {
    expect(valorItem(20_000, 1050)).toBe(2100); // 2 un
    expect(valorItem(5_000, 1001)).toBe(501); // 0,5 × 10,01 = 5,005 → 5,01
    expect(valorItem(5_000, 1000)).toBe(500);
    expect(valorItem(1, 1)).toBe(0); // 0,0001 un
    expect(valorItem(5_000, 1)).toBe(1); // 0,5 centavo → 1
  });
  it('RN-CORE-03: não estoura com valores grandes (BigInt)', () => {
    expect(valorItem(9_000_000_000_000, 9_000_000)).toBe(8_100_000_000_000_000);
  });
  it('RN-PED-03: total do item = valor − desconto, nunca negativo', () => {
    expect(totalItem(10_000, 1000, 100, 0)).toBe(900);
    expect(() => totalItem(10_000, 1000, 1001, 0)).toThrow();
    expect(verificarItens([{ sequencia: 2, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 1001 }])).toEqual([
      expect.objectContaining({ rn: 'RN-PED-03', campo: 'itens[0].desconto_centavos' }),
    ]);
    const ok = { sequencia: 1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 };
    expect(verificarItens([ok, { ...ok, sequencia: 7, desconto_centavos: 1001 }])).toEqual([expect.objectContaining({ campo: 'itens[1].desconto_centavos' })]);
    expect(verificarItens([{ sequencia: 1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 1000 }])).toEqual([]);
  });
});
