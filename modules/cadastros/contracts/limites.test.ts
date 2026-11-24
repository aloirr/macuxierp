import { describe, expect, it } from 'vitest';
import { IdExternoValor, CondicaoPagamentoDados, TrocaExternalId } from './index';

describe('limites do external_id e do código da forma (ADR 0019)', () => {

  it('ADR 0019: external_id aceita 200 caracteres e recusa 201', () => {
    expect(IdExternoValor.safeParse('a'.repeat(200)).success).toBe(true);
    expect(IdExternoValor.safeParse('a'.repeat(201)).success).toBe(false);
    expect(TrocaExternalId.safeParse({ external_id: 'a'.repeat(201), motivo: 'x' }).success).toBe(false);
  });

  it('ADR 0019: forma_codigo aceita 30 caracteres e recusa 31', () => {
    const campo = (n: number) => CondicaoPagamentoDados.safeParse({ forma_codigo: 'a'.repeat(n) });
    const temErro = (r: ReturnType<typeof campo>) => !r.success && r.error.issues.some((i) => i.path.includes('forma_codigo'));
    expect(temErro(campo(30))).toBe(false);
    expect(temErro(campo(31))).toBe(true);
  });
});
