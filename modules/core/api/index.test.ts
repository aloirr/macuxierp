import { describe, expect, it } from 'vitest';
import * as certificado from '../domain/certificado';
import { lerChaveA1 as lerChaveA1Cifra } from './cifra';
import { alertaVencimento, diasParaVencer, lerChaveA1 } from './index';

describe('T-0033: caminho público da api exporta o que o worker usa do A1', () => {
  it('RN-CORE-06: o index reexporta as mesmas funções (identidade) e arredonda 29,9 dias para 29', () => {
    expect(lerChaveA1).toBe(lerChaveA1Cifra);
    expect(diasParaVencer).toBe(certificado.diasParaVencer);
    expect(alertaVencimento).toBe(certificado.alertaVencimento);
    const agora = new Date('2026-06-10T12:00:00Z');
    expect(diasParaVencer(new Date(agora.getTime() + 29.9 * 86_400_000), agora)).toBe(29);
  });
});
