import { describe, expect, it } from 'vitest';
import { compararBinario, externalIdForma, hashRegistro, jsonCanonico, uuidV5 } from './canonico';

describe('canônico, hash e UUID v5', () => {
  it('RN-INF-03: JSON canônico ordena chaves e ignora undefined', () => {
    expect(jsonCanonico({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('RN-INF-03: o hash ignora alterado_em e a ordem das chaves', () => {
    const a = hashRegistro({ external_id: 'x', nome: 'A', alterado_em: '2026-01-01T00:00:00.000Z' });
    const b = hashRegistro({ nome: 'A', alterado_em: '2030-01-01T00:00:00.000Z', external_id: 'x' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRegistro({ external_id: 'x', nome: 'B' })).not.toBe(a);
  });

  it('M2: UUID v5 conhecido (RFC 4122, namespace DNS)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('M2: external_id da forma é estável e separa tenants', () => {
    expect(externalIdForma('t1', '01')).toBe(externalIdForma('t1', '01'));
    expect(externalIdForma('11111111-1111-4111-8111-111111111111', '01')).toBe('0e382c57-67bd-57a9-87a2-cb9edb41469f');
    expect(externalIdForma('t1', '01')).not.toBe(externalIdForma('t2', '01'));
  });

  it('RN-INF-02: ordem binária C (maiúscula antes de minúscula)', () => {
    expect(compararBinario('B', 'a')).toBeLessThan(0);
    expect(compararBinario('a', 'a')).toBe(0);
  });
});
