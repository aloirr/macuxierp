import { describe, expect, it } from 'vitest';
import { prefixoExibido } from './credencial';

describe('prefixo da credencial', () => {
  it('RF-INF-05: prefixo tem no máximo 8 caracteres e no máximo 1/4 da chave', () => {
    expect(prefixoExibido('a'.repeat(32))).toHaveLength(8);
    expect(prefixoExibido('a'.repeat(512))).toHaveLength(8);
    expect(prefixoExibido('abcdefghijklmnop')).toBe('abcd');
    expect(prefixoExibido('abc')).toBe('');
  });
});
