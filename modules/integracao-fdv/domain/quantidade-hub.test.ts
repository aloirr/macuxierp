import { describe, expect, it } from 'vitest';
import { fatorAceitoNoHub, FATOR_MAXIMO_HUB } from './quantidade-hub';

describe('T-0085: limite do fator no Hub', () => {
  it('RN-INF-04: o fator do Hub vai até 9999', () => {
    expect(FATOR_MAXIMO_HUB).toBe(9999);
  });
});

describe('T-0097: fração aceita só em KG e M, até 4 casas (RN-CAD-17, RN-INF-07)', () => {
  it('RN-CAD-17: inteiro passa em qualquer unidade; fração só em KG e M (sem diferenciar caixa)', () => {
    expect(fatorAceitoNoHub('CX', 12)).toBe(true);
    expect(fatorAceitoNoHub('CX', 1.5)).toBe(false);
    expect(fatorAceitoNoHub('UN', 0.5)).toBe(false);
    expect(fatorAceitoNoHub('KG', 1.5)).toBe(true);
    expect(fatorAceitoNoHub('m', 0.2501)).toBe(true);
    expect(fatorAceitoNoHub('KG', 1.23456)).toBe(false);
  });
});
