import { describe, expect, it } from 'vitest';
import { CHAVE_CODIGO_ANTIGA, limparCodigoAntigo } from './chave-antiga';

const memoria = (ini: Record<string, string> = {}) => {
  const m = new Map(Object.entries(ini));
  return { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k), tem: (k: string) => m.has(k) };
};

describe('chave antiga do código da empresa (ADR 0021)', () => {
  it('lê uma vez e remove', () => {
    const s = memoria({ [CHAVE_CODIGO_ANTIGA]: 'ACME', outra: '1' });
    expect(limparCodigoAntigo(s)).toBe('ACME');
    expect(s.tem(CHAVE_CODIGO_ANTIGA)).toBe(false);
    expect(s.tem('outra')).toBe(true);
    expect(limparCodigoAntigo(s)).toBeNull();
  });
  it('sem a chave ou sem armazenamento, não faz nada', () => {
    expect(limparCodigoAntigo(memoria())).toBeNull();
    expect(limparCodigoAntigo(null)).toBeNull();
  });
  it('armazenamento que falha não derruba a tela', () => {
    expect(limparCodigoAntigo({ getItem: () => { throw new Error('bloqueado'); }, removeItem: () => {} })).toBeNull();
  });
});
