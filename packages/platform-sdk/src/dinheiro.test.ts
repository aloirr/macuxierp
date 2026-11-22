import { describe, expect, it } from 'vitest';
import { aplicarAliquota, centavos, ratear, valorItem } from './dinheiro';

describe('dinheiro em centavos', () => {
  it('recusa valor que não é inteiro', () => {
    expect(() => centavos(10.5)).toThrow(RangeError);
  });

  it('aplica alíquota arredondando meio para cima', () => {
    expect(aplicarAliquota(centavos(10_000), 18)).toBe(1_800);
    expect(aplicarAliquota(centavos(333), 1.65)).toBe(5); // 5,4945 → 5
    expect(aplicarAliquota(centavos(1_000), 0.65)).toBe(7); // 6,5 → 7
  });

  it('rateia sem perder centavo e põe a diferença na primeira parcela', () => {
    const p = ratear(centavos(10_000), 3);
    expect(p).toEqual([3_334, 3_333, 3_333]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('RN-CORE-03: valor do item = arred(qtd4 × preço / 10⁴), meio para cima, como o vProd da NF-e', () => {
    expect(valorItem(20_000, 1_050)).toBe(2_100); // 2 un × 10,50
    expect(valorItem(5_000, 1_001)).toBe(501); // 0,5 × 10,01 = 5,005 → 5,01
    expect(valorItem(5_000, 1_000)).toBe(500);
    expect(valorItem(1, 1)).toBe(0); // 0,0001 un × 0,01 → 0
    expect(valorItem(5_000, 1)).toBe(1); // meio centavo → 1
    expect(valorItem(4_999, 1)).toBe(0); // abaixo do meio → 0
    expect(valorItem(0, 1_000)).toBe(0);
  });

  it('RN-CORE-03: em BigInt, não estoura no produto intermediário', () => {
    expect(valorItem(9_000_000_000_000, 9_000_000)).toBe(8_100_000_000_000_000);
  });

  it('RN-CORE-03: RangeError fora do inteiro seguro (entrada ou resultado)', () => {
    expect(() => valorItem(1.5, 100)).toThrow(RangeError);
    expect(() => valorItem(10_000, 10.5)).toThrow(RangeError);
    expect(() => valorItem(2 ** 53, 1)).toThrow(RangeError);
    expect(() => valorItem(Number.MAX_SAFE_INTEGER, 20_000)).toThrow(RangeError);
  });
});
