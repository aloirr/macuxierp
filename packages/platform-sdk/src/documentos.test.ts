import { describe, expect, it } from 'vitest';
import { Cnpj, cnpjRaiz, cnpjValido, Cpf, cpfValido, ieComDvValido, normalizarDocumento, PADRAO_UF, UFS } from './documentos';

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

describe('IE com DV pela regra da UF (RN-CAD-02), AM, PA e SP', () => {
  it('RN-CAD-02: AM aceita o DV certo e recusa o errado ou o tamanho errado', () => {
    expect(ieComDvValido('AM', '041234561')).toBe(true);
    expect(ieComDvValido('AM', '04.987.654-6')).toBe(true);
    expect(ieComDvValido('AM', '041234562')).toBe(false);
    expect(ieComDvValido('AM', '04123456')).toBe(false);
  });
  it('RN-CAD-02: AM com soma menor que 11 usa 11 − soma', () => {
    // 0000000 1 × 2 = 2 → DV 9
    expect(ieComDvValido('AM', '000000019')).toBe(true);
    expect(ieComDvValido('am', '000000010')).toBe(false);
  });
  it('RN-CAD-02: PA exige o prefixo 15 e o DV', () => {
    expect(ieComDvValido('PA', '151234566')).toBe(true);
    expect(ieComDvValido('PA', '151234565')).toBe(false);
    expect(ieComDvValido('PA', '161234566')).toBe(false);
  });
  it('RN-CAD-02: SP confere os dois DV (9ª e 12ª posições), com ou sem máscara (RD-0253)', () => {
    expect(ieComDvValido('SP', '110042490114')).toBe(true);
    expect(ieComDvValido('SP', '110.042.490.114')).toBe(true);
    expect(ieComDvValido('SP', '110042490115')).toBe(false);
    expect(ieComDvValido('SP', '110042491114')).toBe(false);
    expect(ieComDvValido('SP', '11004249011')).toBe(false);
  });
  it('RN-CAD-02: ISENTO passa; UF sem regra no ERP dá null', () => {
    expect(ieComDvValido('AM', 'isento')).toBe(true);
    expect(ieComDvValido('RJ', '12345678')).toBeNull();
  });
});

describe('UFS', () => {
  it('as 27 siglas (26 estados e o DF), sem repetição, no formato PADRAO_UF', () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    for (const uf of UFS) expect(PADRAO_UF.test(uf), uf).toBe(true);
    for (const uf of ['AM', 'RR', 'DF', 'SP']) expect(UFS).toContain(uf);
  });
});
