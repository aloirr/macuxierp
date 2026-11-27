import { describe, expect, it } from 'vitest';
import { INTERVALO_SONDAGEM_CREDENCIAL_S, deveSondarCredencial, proximaSondagemCredencialEm, proximaTentativaEm } from './sondagem';

const t0 = new Date('2026-11-27T12:00:00Z');
const apos = (s: number) => new Date(t0.getTime() + s * 1000);

describe('sondagem da credencial recusada (decisão 25 B)', () => {
  it('RN-INF-04: o intervalo é de 30 minutos', () => {
    expect(INTERVALO_SONDAGEM_CREDENCIAL_S).toBe(1800);
  });
  it('RN-INF-04: antes de 30 min da pausa não sonda', () => {
    expect(deveSondarCredencial(t0, apos(1799))).toBe(false);
  });
  it('RN-INF-04: com 30 min ou mais sonda', () => {
    expect(deveSondarCredencial(t0, apos(1800))).toBe(true);
    expect(deveSondarCredencial(t0, apos(7200))).toBe(true);
  });
  it('RN-INF-04: sem pausa de credencial (null) não sonda', () => {
    expect(deveSondarCredencial(null, apos(9999))).toBe(false);
  });
  it('RN-INF-04: a próxima tentativa é pausada_em + 30 min', () => {
    expect(proximaSondagemCredencialEm(t0)?.toISOString()).toBe('2026-11-27T12:30:00.000Z');
    expect(proximaSondagemCredencialEm(null)).toBeNull();
  });
  it('RN-INF-04: proximaTentativaEm só devolve data para pausa sondável com pausada_em', () => {
    expect(proximaTentativaEm('credencial', t0)).toEqual(apos(1800));
    expect(proximaTentativaEm('licenca_fdv', t0.toISOString())).toEqual(apos(1800));
    expect(proximaTentativaEm('manual', t0)).toBeNull();
    expect(proximaTentativaEm(null, t0)).toBeNull();
    expect(proximaTentativaEm('credencial', null)).toBeNull();
  });
});
