import { describe, expect, it } from 'vitest';
import { chaveHub } from './chave';

const ID = '00000000-0000-4000-8000-000000000001';

describe('RN-INF-02: chave do registro no Hub (decisão de 21/11/2026, 23h22)', () => {
  it('usa o external_id da carga (T-0026) quando existe, aparado', () => {
    expect(chaveHub({ id: ID, external_id: '  CLI-0042 ' })).toBe('CLI-0042');
  });

  it('cai no UUID do ERP quando o external_id é nulo, ausente ou vazio', () => {
    expect(chaveHub({ id: ID, external_id: null })).toBe(ID);
    expect(chaveHub({ id: ID })).toBe(ID);
    expect(chaveHub({ id: ID, external_id: '   ' })).toBe(ID);
  });

  it('é estável: a mesma entrada sempre dá a mesma chave', () => {
    expect(chaveHub({ id: ID, external_id: 'X' })).toBe(chaveHub({ id: ID, external_id: 'X' }));
  });
});
