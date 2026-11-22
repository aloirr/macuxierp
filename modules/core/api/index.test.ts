import { describe, expect, it } from 'vitest';
import * as certificado from '../domain/certificado';
import * as leitura from './leitura-a1';
import * as indice from './index';

describe('T-0045/T-0021: caminho público da api exporta o que o worker usa do A1', () => {
  it('RN-CORE-06: o index reexporta as mesmas funções do domain (identidade) e arredonda 29,9 dias para 29', () => {
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

describe('T-0011: chave mestra do A1', () => {
  it('ADR 0005: o index expõe o lerChaveA1, que lê os mesmos 32 bytes em hex e em base64 e não ecoa valor inválido', () => {
    const bytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7));
    expect(indice.lerChaveA1(bytes.toString('hex')).equals(bytes)).toBe(true);
    expect(indice.lerChaveA1(bytes.toString('base64')).equals(bytes)).toBe(true);
    expect(() => indice.lerChaveA1('valor-secreto-invalido')).toThrow(/MACUXIERP_CHAVE_A1/);
    expect(() => indice.lerChaveA1('valor-secreto-invalido')).not.toThrow(/valor-secreto-invalido/);
  });
});
