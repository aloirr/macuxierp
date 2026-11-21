import { describe, expect, it } from 'vitest';
import { formatarCentavos, formatarDocumento, formatarQuantidade, interpretarCentavos, interpretarQuantidade } from './formatar';

describe('formatação do BKO', () => {
  it('RN-CAD-01: mostra CNPJ e CPF com máscara; CNPJ alfanumérico também', () => {
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(formatarDocumento('123')).toBe('123');
  });
  it('dinheiro: centavos inteiros viram R$ e voltam sem float', () => {
    expect(formatarCentavos(123456)).toBe('R$ 1.234,56');
    expect(formatarCentavos(5)).toBe('R$ 0,05');
    expect(formatarCentavos(-250)).toBe('-R$ 2,50');
    expect(interpretarCentavos('1.234,56')).toBe(123456);
    expect(interpretarCentavos('0,05')).toBe(5);
    expect(interpretarCentavos('abc')).toBeNull();
  });
  it('D11: quantidade × 10^4 vira decimal e volta sem float', () => {
    expect(formatarQuantidade(125_000)).toBe('12,5');
    expect(formatarQuantidade(-10_000)).toBe('-1');
    expect(formatarQuantidade(1)).toBe('0,0001');
    expect(interpretarQuantidade('12,5')).toBe(125_000);
    expect(interpretarQuantidade('0,0001')).toBe(1);
    expect(interpretarQuantidade('1,00001')).toBeNull();
  });
});
