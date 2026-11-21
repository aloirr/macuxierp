import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { alertaVencimento, diasParaVencer, lerChaveA1 } from './index';

describe('T-0033: caminho público da api exporta o que o worker usa do A1', () => {
  it('RN-CORE-06: lerChaveA1 pelo index aceita 32 bytes em hex e rejeita ausente', () => {
    expect(lerChaveA1(randomBytes(32).toString('hex'))).toHaveLength(32);
    expect(() => lerChaveA1(undefined)).toThrow();
  });

  it('RN-CORE-06 e RF-CORE-04: diasParaVencer e alertaVencimento pelo index', () => {
    const agora = new Date('2026-06-10T12:00:00Z');
    const em = (dias: number): Date => new Date(agora.getTime() + dias * 86_400_000);
    expect(diasParaVencer(em(29.9), agora)).toBe(29);
    expect(alertaVencimento(em(30), agora)).toBe(true);
    expect(alertaVencimento(em(31), agora)).toBe(false);
  });
});
