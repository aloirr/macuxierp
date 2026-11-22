import { describe, expect, it } from 'vitest';
import { codigoBarras128C } from './codigo-barras';

// Vetor calculado por script Python independente (tabela de padrões do CODE-128, soma ponderada mod 103).
const CHAVE = '13260404641538000145550010000001231234567890';
const VETOR_LARGURAS =
  '2112321221323212211213221213221114221132221323112122222221221131233113212122222213122122222122222221223121311122321311233311212411122141212313112331112';

describe('CODE-128 C da chave (RF-FAT-03, MOC Anexo II)', () => {
  it('RF-FAT-03: a chave de 44 dígitos vira start C, 22 pares, checksum mod 103 e stop, igual ao vetor do script independente', () => {
    const c = codigoBarras128C(CHAVE);
    expect(c.valores[0]).toBe(105);
    expect(c.valores.at(-2)).toBe(41);
    expect(c.valores.at(-1)).toBe(106);
    expect(c.valores).toHaveLength(1 + 22 + 1 + 1);
    expect(c.larguras.join('')).toBe(VETOR_LARGURAS);
    expect(c.modulos).toBe(24 * 11 + 13);
  });

  it('RF-FAT-03: o menor caso confere o checksum (105 + 0 = 105 mod 103 = 2)', () => {
    expect(codigoBarras128C('00').larguras.join('')).toBe('2112322122222222212331112');
  });

  it('RF-FAT-03: recusa texto com letras ou quantidade ímpar de dígitos', () => {
    expect(() => codigoBarras128C('123')).toThrow(RangeError);
    expect(() => codigoBarras128C('12a4')).toThrow(RangeError);
  });
});
