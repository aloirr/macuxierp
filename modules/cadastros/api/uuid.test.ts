import { describe, expect, it } from 'vitest';
import { agregadoEstoque, uuidV5 } from './uuid';

describe('uuid v5', () => {
  it('bate com o vetor do RFC 4122 (DNS, www.example.com)', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('o agregado do estoque é estável por filial e produto (eventos.md)', () => {
    const f = '00000000-0000-4000-8000-000000000001';
    const p = '00000000-0000-4000-8000-0000000000a1';
    expect(agregadoEstoque(f, p)).toBe(agregadoEstoque(f, p));
    expect(agregadoEstoque(f, p)).not.toBe(agregadoEstoque(p, f));
  });
});
