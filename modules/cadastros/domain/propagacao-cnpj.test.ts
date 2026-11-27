import { describe, expect, it } from 'vitest';
import { precisaGravarCnpjDaFilialPadrao } from './propagacao-cnpj';

describe('propagação do CNPJ da empresa para a filial padrão', () => {
  it('RN-CORE-14: CNPJ diferente da filial padrão precisa gravar', () => {
    expect(precisaGravarCnpjDaFilialPadrao('11444777000161', '04252011000110')).toBe(true);
  });
  it('RN-CORE-16: o mesmo CNPJ, com ou sem máscara, não grava', () => {
    expect(precisaGravarCnpjDaFilialPadrao('11444777000161', '11444777000161')).toBe(false);
    expect(precisaGravarCnpjDaFilialPadrao('11.444.777/0001-61', '11444777000161')).toBe(false);
  });
  it('RN-CORE-16: filial sem CNPJ gravado precisa gravar', () => {
    expect(precisaGravarCnpjDaFilialPadrao(null, '11444777000161')).toBe(true);
  });
});
