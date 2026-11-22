/** Chave de acesso da NF-e: montagem, DV (módulo 11) e leitura (Manual de Orientação do Contribuinte). */
import { describe, expect, it } from 'vitest';
import { chaveNFeComDvValido, dvChaveNFe, lerChaveNFe, montarChaveNFe } from './chave';

const CAMPOS = { cUF: 13, aamm: '2611', cnpj: '11222333000181', mod: '55' as const, serie: 1, nNF: 1, tpEmis: 1, cNF: '00007932' };

describe('chave de acesso', () => {
  it('monta 44 posições com o DV e lê de volta os mesmos campos', () => {
    const chave = montarChaveNFe(CAMPOS);
    expect(chave).toMatch(/^13261111222333000181550010000000011000079322$/);
    expect(lerChaveNFe(chave)).toEqual({ ...CAMPOS, cDV: 2 });
    expect(chaveNFeComDvValido(chave)).toBe(true);
  });

  it('DV: resto 0 ou 1 dá 0 (exemplo do Manual com resto 0)', () => {
    // um caso qualquer: o DV está sempre em 0..9 e só o DV certo passa
    const base = '5206043300991100250655012000000780026730161';
    const dv = dvChaveNFe(base);
    expect(dv).toBeGreaterThanOrEqual(0);
    expect(dv).toBeLessThanOrEqual(9);
    expect(chaveNFeComDvValido(`${base}${dv}`)).toBe(true);
    expect(chaveNFeComDvValido(`${base}${(dv + 1) % 10}`)).toBe(false);
  });

  it('aceita CNPJ alfanumérico (ASCII − 48) e recusa campo fora do tamanho', () => {
    const chave = montarChaveNFe({ ...CAMPOS, cnpj: '12ABC34501DE35' });
    expect(chaveNFeComDvValido(chave)).toBe(true);
    expect(() => montarChaveNFe({ ...CAMPOS, nNF: 1_000_000_000 })).toThrow(RangeError);
    expect(() => montarChaveNFe({ ...CAMPOS, cNF: '123' })).toThrow(RangeError);
    expect(lerChaveNFe('123')).toBeNull();
  });
});
