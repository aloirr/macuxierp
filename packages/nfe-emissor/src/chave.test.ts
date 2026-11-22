import { describe, expect, it } from 'vitest';
import { cnfValido, gerarCNF } from './chave';

describe('cNF (o DV e a montagem da chave são testados no nfe-sefaz)', () => {
  it('não repete o nNF nem usa sequência trivial', () => {
    expect(cnfValido('00000042', 42)).toBe(false);
    expect(cnfValido('11111111', 1)).toBe(false);
    expect(cnfValido('12345678', 1)).toBe(false);
    expect(cnfValido('48213705', 1)).toBe(true);
    expect(cnfValido('4821370', 1)).toBe(false);
  });
  it('sorteia de novo até achar um cNF válido', () => {
    const sorteios = [42, 11111111, 48213705];
    expect(gerarCNF(42, () => sorteios.shift() ?? 0)).toBe('48213705');
  });
  it('sorteio real sai com 8 dígitos e válido', () => {
    for (let i = 0; i < 50; i++) expect(cnfValido(gerarCNF(7), 7)).toBe(true);
  });
});
