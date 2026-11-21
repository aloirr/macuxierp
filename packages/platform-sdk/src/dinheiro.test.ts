import { describe, expect, it } from 'vitest';
import { aplicarAliquota, centavos, ratear } from './dinheiro';

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
});
