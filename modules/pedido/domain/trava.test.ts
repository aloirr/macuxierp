import { describe, expect, it } from 'vitest';
import { travaCliente } from './trava';

const T = '00000000-0000-4000-8000-000000000001';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

describe('trava de crédito por cliente', () => {
  it('RN-PED-04: a chave é estável para o mesmo tenant e cliente', () => {
    expect(travaCliente(T, C1)).toBe(travaCliente(T, C1));
  });
  it('RN-PED-04: clientes diferentes e tenants diferentes dão chaves diferentes', () => {
    expect(travaCliente(T, C1)).not.toBe(travaCliente(T, C2));
    expect(travaCliente(C1, T)).not.toBe(travaCliente(T, C1));
  });
  it('RN-PED-04: cabe em int64 (pg_advisory_xact_lock)', () => {
    const k = travaCliente(T, C1);
    expect(typeof k).toBe('bigint');
    expect(k >= INT64_MIN && k <= INT64_MAX).toBe(true);
  });
});
