import { describe, expect, it } from 'vitest';
import { aplicarAliquotaCentavos, centavosParaXml, decimalParaEscala, formatarEscala, multiplicarParaCentavos } from './decimal';

describe('conversão de centavos para o leiaute (RN-CORE-03, regra 4)', () => {
  it('sempre 2 casas, sem float', () => {
    expect(centavosParaXml(0)).toBe('0.00');
    expect(centavosParaXml(5)).toBe('0.05');
    expect(centavosParaXml(123456)).toBe('1234.56');
    expect(centavosParaXml(9_007_199_254_740_991)).toBe('90071992547409.91');
  });
  it('recusa negativo e não inteiro', () => {
    expect(() => centavosParaXml(-1)).toThrow(RangeError);
    expect(() => centavosParaXml(1.5)).toThrow(RangeError);
  });
  it('quantidade com 4 casas e valor unitário com 10', () => {
    expect(formatarEscala(decimalParaEscala('2', 4), 4)).toBe('2.0000');
    expect(formatarEscala(decimalParaEscala('0.001', 4), 4)).toBe('0.0010');
    expect(formatarEscala(decimalParaEscala('10.5', 10), 10)).toBe('10.5000000000');
    expect(() => decimalParaEscala('1.12345', 4)).toThrow(/mais de 4 casas/);
    expect(() => decimalParaEscala('1,5', 4)).toThrow(/inválido/);
  });
});

describe('arredondamento na 2ª casa pelo dividirArredondando do SDK (RN-CORE-03 e RN-FIS-03)', () => {
  it('vProd = qCom × vUnCom arredondado na 2ª casa', () => {
    expect(multiplicarParaCentavos('3', '33.3')).toBe(9990);
    expect(multiplicarParaCentavos('1.5', '0.333')).toBe(50); // 0.4995 → 0.50
    expect(multiplicarParaCentavos('0.0001', '0.0000000001')).toBe(0);
    expect(multiplicarParaCentavos('1', '0.005')).toBe(1); // empate: meio para cima
    expect(multiplicarParaCentavos('1', '0.005', 'meio-para-par')).toBe(0);
  });
  it('tributo = base × alíquota em texto; o empate exato decide pelo modo', () => {
    // 2100 centavos × 1,65% = 34,65 centavos → 35
    expect(aplicarAliquotaCentavos(2100, '1.65', 'meio-para-cima')).toBe(35);
    // 50 × 1% = 0,5 centavo
    expect(aplicarAliquotaCentavos(50, '1', 'meio-para-cima')).toBe(1);
    expect(aplicarAliquotaCentavos(50, '1', 'meio-para-par')).toBe(0);
  });
});
