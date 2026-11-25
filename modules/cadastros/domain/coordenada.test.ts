import { describe, expect, it } from 'vitest';
import { normalizarCoordenada } from './coordenada';

describe('coordenada do endereço (T-0096)', () => {
  it('T-0096: dentro da faixa (inclusive os limites) é mantida', () => {
    expect(normalizarCoordenada(-3.1, -60.02)).toEqual({ latitude: -3.1, longitude: -60.02 });
    expect(normalizarCoordenada(90, 180)).toEqual({ latitude: 90, longitude: 180 });
    expect(normalizarCoordenada(-90, -180)).toEqual({ latitude: -90, longitude: -180 });
    expect(normalizarCoordenada(0, 0)).toEqual({ latitude: 0, longitude: 0 });
  });
  it('T-0096: fora da faixa ou não numérico grava nulo nos dois', () => {
    for (const [la, lo] of [[91, 10], [-90.1, 10], [10, 180.1], [10, -181], [Number.NaN, 1], [1, Infinity], ['-3.1', '-60']]) {
      expect(normalizarCoordenada(la, lo), `${la}/${lo}`).toEqual({ latitude: null, longitude: null });
    }
  });
  it('T-0096: só um dos dois válido deixa os dois nulos', () => {
    expect(normalizarCoordenada(-3.1, null)).toEqual({ latitude: null, longitude: null });
    expect(normalizarCoordenada(undefined, -60)).toEqual({ latitude: null, longitude: null });
    expect(normalizarCoordenada(-3.1, 200)).toEqual({ latitude: null, longitude: null });
  });
  it('T-0096: ausentes viram nulo', () => {
    expect(normalizarCoordenada(undefined, undefined)).toEqual({ latitude: null, longitude: null });
    expect(normalizarCoordenada(null, null)).toEqual({ latitude: null, longitude: null });
  });
});
