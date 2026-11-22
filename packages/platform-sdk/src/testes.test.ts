import { describe, expect, it } from 'vitest';
import pacote from '../package.json';
import { semEspacoDuro } from './testes';

describe('semEspacoDuro (RD-0705)', () => {
  it('troca NBSP (U+00A0) e espaço estreito (U+202F) por espaço comum', () => {
    expect(semEspacoDuro('R$\u00a01.234,56')).toBe('R$ 1.234,56');
    expect(semEspacoDuro('21/11/2026\u202f19:05')).toBe('21/11/2026 19:05');
    expect(semEspacoDuro('a\u00a0b\u202fc\u00a0d')).toBe('a b c d');
    expect(semEspacoDuro('já comum')).toBe('já comum');
  });

  it('null e undefined voltam como estão', () => {
    expect(semEspacoDuro(null)).toBeNull();
    expect(semEspacoDuro(undefined)).toBeUndefined();
  });

  it('sai pelo subcaminho ./testes', () => {
    expect((pacote.exports as Record<string, string>)['./testes']).toBe('./src/testes.ts');
  });
});
