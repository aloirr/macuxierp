import { describe, expect, it } from 'vitest';
import { interpretarCentavos } from '@macuxierp/platform-sdk/formatar';
import { semPrefixoMoeda, textoCentavos, textoQuantidade } from './texto';

const NBSP = ' ';
const ESTREITO = ' ';

describe('textoCentavos (T-0015, R-20261122-040434)', () => {
  it('RN-PED-03: tira o R$ com espaço comum, NBSP ou espaço estreito', () => {
    for (const sp of [' ', NBSP, ESTREITO]) {
      expect(semPrefixoMoeda(`R$${sp}12,50`)).toBe('12,50');
      expect(semPrefixoMoeda(`R$${sp}1.234,56`)).toBe('1.234,56');
    }
  });

  it('RN-PED-03: preserva o sinal negativo nas duas posições', () => {
    expect(semPrefixoMoeda(`-R$${NBSP}12,50`)).toBe('-12,50');
    expect(semPrefixoMoeda(`R$${NBSP}-12,50`)).toBe('-12,50');
    expect(semPrefixoMoeda('12,50')).toBe('12,50');
  });

  it('RN-PED-03: interpretarCentavos(textoCentavos(x)) volta ao valor original', () => {
    for (const c of [0, 5, 1250, 123456, 100000000]) {
      expect(textoCentavos(c)).not.toContain('R$');
      expect(interpretarCentavos(textoCentavos(c))).toBe(c);
    }
    expect(textoCentavos(1250)).toBe('12,50');
  });

  it('RN-PED-03: textoQuantidade não usa espaço e é inverso do formato do campo', () => {
    expect(textoQuantidade(125000)).toBe('12,5');
    expect(textoQuantidade(10000)).toBe('1');
    expect(textoQuantidade(1234567)).not.toMatch(/\s/);
  });
});
