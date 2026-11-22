import { describe, expect, it } from 'vitest';
import * as certificado from '../domain/certificado';
import { lerChaveA1 as lerChaveA1Cifra } from './cifra';
import * as leitura from './leitura-a1';
import * as indice from './index';

describe('T-0045/T-0021: caminho público da api exporta o que o worker usa do A1', () => {
  it('RN-CORE-06: o index reexporta as mesmas funções (identidade) e arredonda 29,9 dias para 29', () => {
    expect(indice.lerChaveA1).toBe(lerChaveA1Cifra);
    expect(indice.diasParaVencer).toBe(certificado.diasParaVencer);
    expect(indice.alertaVencimento).toBe(certificado.alertaVencimento);
    const agora = new Date('2026-06-10T12:00:00Z');
    expect(indice.diasParaVencer(new Date(agora.getTime() + 29.9 * 86_400_000), agora)).toBe(29);
  });
});

describe('T-0045/T-0021: leitura do A1 pelo worker', () => {
  it('RN-CORE-06: o index reexporta lerA1DecifradoDaFilial e não exporta cifrarA1', () => {
    expect(indice.lerA1DecifradoDaFilial).toBe(leitura.lerA1DecifradoDaFilial);
    expect('cifrarA1' in indice).toBe(false);
    expect('decifrarA1' in indice).toBe(false);
  });
});
