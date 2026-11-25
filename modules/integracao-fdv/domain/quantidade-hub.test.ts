import { describe, expect, it } from 'vitest';
import { FATOR_MAXIMO_HUB, qtd4InteiraParaHub, unidadesInteirasParaHub } from './quantidade-hub';

describe('T-0085: quantidade inteira para o Hub (Qtd4, 4 casas)', () => {
  it('RN-INF-04: Qtd4 múltipla de 10000 é inteira; com casas decimais não é', () => {
    expect(qtd4InteiraParaHub(30000)).toBe(true);
    expect(qtd4InteiraParaHub(10000)).toBe(true);
    expect(qtd4InteiraParaHub(15000)).toBe(false);
    expect(qtd4InteiraParaHub(1)).toBe(false);
    expect(qtd4InteiraParaHub(-20000)).toBe(true);
    expect(qtd4InteiraParaHub(Number.NaN)).toBe(false);
  });

  it('RN-INF-04: o mesmo teste sobre o valor já em unidades (payload do lote)', () => {
    expect(unidadesInteirasParaHub(3)).toBe(true);
    expect(unidadesInteirasParaHub(1.5)).toBe(false);
    expect(unidadesInteirasParaHub(0.0001)).toBe(false);
    expect(unidadesInteirasParaHub(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('RN-INF-04: o fator do Hub vai até 9999', () => {
    expect(FATOR_MAXIMO_HUB).toBe(9999);
  });
});
