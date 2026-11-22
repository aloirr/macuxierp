import { describe, expect, it } from 'vitest';
import { aammManaus, chaveValida, dvModulo11, gerarCnf, montarChave } from './chave';

const base = { aamm: '2611', cnpj: '11222333000181', serie: 1, tpEmis: 1 as const, cnf: '12345678' };

describe('chave de acesso', () => {
  it('RN-FAT-01: monta 44 dígitos (cUF 13, AAMM, CNPJ, mod 55, série, nNF, tpEmis, cNF, DV)', () => {
    // vetores com o DV calculado à parte (script independente, pesos 2..9)
    expect(montarChave({ ...base, numero: 123 })).toBe('13261111222333000181550010000001231123456780');
    expect(montarChave({ aamm: '2601', cnpj: '04252011000110', serie: 1, numero: 1, tpEmis: 1, cnf: '00000002' })).toBe('13260104252011000110550010000000011000000029');
    expect(montarChave({ aamm: '2612', cnpj: '11222333000181', serie: 999, numero: 999_999_999, tpEmis: 6, cnf: '87654321' })).toBe('13261211222333000181559999999999996876543214');
  });
  it('RN-FAT-01: CNPJ alfanumérico (NT 2025.001) entra na chave e o DV usa ASCII − 48 (DV calculado por script independente)', () => {
    const chave = montarChave({ aamm: '2611', cnpj: '12ABC34501DE35', serie: 1, numero: 123, tpEmis: 1, cnf: '87654321' });
    expect(chave).toBe('13261112ABC34501DE35550010000001231876543214');
    expect(chaveValida(chave)).toBe(true);
    expect(chaveValida(chave.slice(0, 43) + '5')).toBe(false);
    expect(chaveValida('13261112abc34501de35550010000001231876543214')).toBe(false);
    expect(() => montarChave({ aamm: '2611', cnpj: '12ABC34501DEAB', serie: 1, numero: 1, tpEmis: 1, cnf: '12345678' })).toThrow();
  });
  it('RN-FAT-01: DV módulo 11 com resto 0 ou 1 vira 0', () => {
    expect(montarChave({ ...base, numero: 7 }).endsWith('0')).toBe(true); // resto 0
    expect(montarChave({ ...base, numero: 16 }).endsWith('0')).toBe(true); // resto 1
    expect(dvModulo11('4')).toBe(3);
  });
  it('RN-FAT-01: chaveValida confere tamanho e DV', () => {
    expect(chaveValida('13261111222333000181550010000001231123456780')).toBe(true);
    expect(chaveValida('13261111222333000181550010000001231123456781')).toBe(false);
    expect(chaveValida('1326')).toBe(false);
  });
  it('RN-FAT-01: recusa dados fora do leiaute', () => {
    expect(() => montarChave({ ...base, numero: 0 })).toThrow();
    expect(() => montarChave({ ...base, numero: 1, cnpj: '123' })).toThrow();
    expect(() => montarChave({ ...base, numero: 1, serie: 1000 })).toThrow();
  });
  it('RN-FAT-01: AAMM no fuso de Manaus', () => {
    expect(aammManaus(new Date('2026-12-01T02:00:00Z'))).toBe('2611'); // 30/11 22h em Manaus
    expect(aammManaus(new Date('2026-12-01T05:00:00Z'))).toBe('2612');
  });
  it('RN-FAT-01: cNF de 8 dígitos nunca igual ao nNF', () => {
    const sorteios = [123, 5];
    expect(gerarCnf(123, () => sorteios.shift() as number)).toBe('00000005');
    expect(gerarCnf(9, () => 424242)).toBe('00424242');
    for (let i = 0; i < 200; i++) expect(gerarCnf(i + 1)).toMatch(/^\d{8}$/);
  });
});
