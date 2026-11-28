import { describe, expect, it } from 'vitest';
import { normalizarEmailUsuario } from './email-unico';

describe('RN-CORE-18: e-mail único no sistema todo', () => {
  it('RN-CORE-18: normaliza em minúsculas e sem espaços', () => {
    expect(normalizarEmailUsuario('  Ana.Silva@Empresa.COM.br ')).toBe('ana.silva@empresa.com.br');
    expect(normalizarEmailUsuario('a b@x.com')).toBe('ab@x.com');
  });
});
