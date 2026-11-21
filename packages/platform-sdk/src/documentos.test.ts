import { describe, expect, it } from 'vitest';
import { Cnpj, cnpjRaiz, cnpjValido, Cpf, cpfValido, normalizarDocumento } from './documentos';

describe('CNPJ e CPF (RN-CAD-01)', () => {
  it('RN-CAD-01: aceita CNPJ numérico válido, com ou sem máscara', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000181')).toBe(true);
  });

  it('RN-CAD-01: aceita CNPJ alfanumérico válido (exemplo da Receita), em minúsculas também', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValido('12abc34501de35')).toBe(true);
  });

  it('RN-CAD-01: recusa DV errado, tamanho errado, letra no DV e todos iguais', () => {
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('12.ABC.345/01DE-36')).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('12ABC34501DEA5')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });

  it('RN-CAD-01: CPF válido e inválido', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
  });

  it('RN-CAD-01: Zod normaliza e explica o erro com a regra', () => {
    expect(Cnpj.parse('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(Cpf.parse('529.982.247-25')).toBe('52998224725');
    const r = Cnpj.safeParse('11.222.333/0001-82');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/^RN-CAD-01/);
  });

  it('raiz do CNPJ são as 8 primeiras posições (D4)', () => {
    expect(cnpjRaiz('12.ABC.345/01DE-35')).toBe('12ABC345');
    expect(normalizarDocumento(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });
});
