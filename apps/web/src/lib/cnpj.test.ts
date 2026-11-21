import { describe, expect, it } from 'vitest';
import { formatarCnpj } from './cnpj';

describe('formatarCnpj', () => {
  it('formata 14 dígitos', () => expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81'));
  it('mantém o que não tem 14 dígitos', () => expect(formatarCnpj('123')).toBe('123'));
});
