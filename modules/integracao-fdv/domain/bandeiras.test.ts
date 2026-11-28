import { describe, expect, it } from 'vitest';
import { enviaStIpi, TENANTS_ENVIA_ST_IPI } from './bandeiras';

describe('bandeira enviaStIpi (T-0132)', () => {
  it('T-0132: versionada e desligada: a lista vem vazia e nenhum tenant envia ST e IPI', () => {
    expect(TENANTS_ENVIA_ST_IPI).toEqual([]);
    expect(enviaStIpi('00000000-0000-4000-8000-000000000001')).toBe(false);
  });
  it('T-0132: ligada só para o tenant da lista', () => {
    expect(enviaStIpi('t1', ['t1'])).toBe(true);
    expect(enviaStIpi('t2', ['t1'])).toBe(false);
  });
});
