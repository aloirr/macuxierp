import { describe, expect, it } from 'vitest';
import { alertaVencimento, diasParaVencer } from './certificado';

const AGORA = new Date('2026-06-10T12:00:00Z');
const MS_DIA = 86_400_000;
const apos = (dias: number): Date => new Date(AGORA.getTime() + dias * MS_DIA);

describe('RN-CORE-06 / RF-CORE-04: arredondamento de diasParaVencer (Math.floor, dias inteiros)', () => {
  it('RN-CORE-06: fração de dia arredonda para baixo (29,9 dias = 29; 0,5 dia = 0)', () => {
    expect(diasParaVencer(apos(29.9), AGORA)).toBe(29);
    expect(diasParaVencer(apos(0.5), AGORA)).toBe(0);
  });

  it('RN-CORE-06: exatamente 30 dias dá 30 e já alerta (RF-CORE-04); 30 dias e 1 ms ainda dá 30; 31 dias não alerta', () => {
    expect(diasParaVencer(apos(30), AGORA)).toBe(30);
    expect(alertaVencimento(apos(30), AGORA)).toBe(true);
    expect(diasParaVencer(new Date(apos(30).getTime() + 1), AGORA)).toBe(30);
    expect(alertaVencimento(apos(31), AGORA)).toBe(false);
  });

  it('RN-CORE-06: já vencido dá negativo, arredondando para baixo (-0,5 dia = -1) e alerta (RF-CORE-04)', () => {
    expect(diasParaVencer(apos(-0.5), AGORA)).toBe(-1);
    expect(diasParaVencer(apos(-3), AGORA)).toBe(-3);
    expect(alertaVencimento(apos(-3), AGORA)).toBe(true);
  });
});
