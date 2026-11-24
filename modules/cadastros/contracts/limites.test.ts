import { describe, expect, it } from 'vitest';
import { EXTERNAL_ID_MAX as SDK_EXTERNAL_ID_MAX, LIMITE_CODIGO_FORMA_PAGAMENTO as SDK_LIMITE_FORMA } from '@macuxierp/platform-sdk/hub-v1';
import { EXTERNAL_ID_MAX, IdExternoValor, LIMITE_CODIGO_FORMA_PAGAMENTO, CondicaoPagamentoDados, TrocaExternalId } from './index';
import { LIMITES } from '../domain/carga/layout';

describe('limites do external_id e do código da forma (ADR 0019)', () => {
  it('ADR 0019: as constantes do contrato são as do hub-v1 do SDK', () => {
    expect(EXTERNAL_ID_MAX).toBe(SDK_EXTERNAL_ID_MAX);
    expect(LIMITE_CODIGO_FORMA_PAGAMENTO).toBe(SDK_LIMITE_FORMA);
    expect(LIMITES.id_externo).toBe(SDK_EXTERNAL_ID_MAX);
    expect(LIMITES.codigo_forma).toBe(SDK_LIMITE_FORMA);
  });

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
