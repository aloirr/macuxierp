import { describe, expect, it } from 'vitest';
import type { NotaNaFaixa } from './inutilizacao';
import { notasInutilizadasPelaFaixa, validarInutilizacao } from './inutilizacao';

const base = { numeroInicial: 10, numeroFinal: 12, proximoNumero: 10, ano: 2026, justificativa: 'Numeração pulada por falha de sistema', notasNaFaixa: [] as NotaNaFaixa[] };

describe('inutilização', () => {
  it('RN-FAT-01: faixa a partir do próximo número, com ano de 4 dígitos e justificativa válida, não tem violação', () => {
    expect(validarInutilizacao(base)).toEqual([]);
  });
  it('RN-FAT-01: inicial ≤ final, dentro de 1..999999999', () => {
    expect(validarInutilizacao({ ...base, numeroInicial: 13 }).map((v) => v.campo)).toContain('faixa');
    expect(validarInutilizacao({ ...base, numeroInicial: 0, proximoNumero: 0 }).map((v) => v.campo)).toContain('faixa');
    expect(validarInutilizacao({ ...base, numeroInicial: 1, numeroFinal: 1, proximoNumero: 1 })).toEqual([]);
    expect(validarInutilizacao({ ...base, numeroInicial: 999999999, numeroFinal: 1_000_000_000, proximoNumero: 999999999 }).map((v) => v.campo)).toContain('faixa');
    expect(validarInutilizacao({ ...base, numeroInicial: 1.5 }).map((v) => v.campo)).toContain('faixa');
  });
  it('RN-FAT-01: o final vai até proximo+99 (limite da 0013)', () => {
    expect(validarInutilizacao({ ...base, numeroFinal: 109 })).toEqual([]);
    expect(validarInutilizacao({ ...base, numeroFinal: 110 }).map((v) => v.campo)).toContain('numeroFinal');
  });
  it('RN-FAT-01: a faixa começa no máximo no próximo número (0013)', () => {
    expect(validarInutilizacao({ ...base, numeroInicial: 10, numeroFinal: 10 })).toEqual([]);
    expect(validarInutilizacao({ ...base, numeroInicial: 11, numeroFinal: 12 }).map((v) => v.campo)).toContain('numeroInicial');
  });
  it('RN-FAT-01: não cobre nota autorizada, cancelada nem em_autorizacao', () => {
    for (const s of ['autorizada', 'cancelada', 'em_autorizacao'] as const)
      expect(validarInutilizacao({ ...base, notasNaFaixa: [{ numero: 11, status: s }] }).map((v) => v.campo)).toContain('notasNaFaixa');
  });
  it('RN-FAT-01: nota fora da faixa não atrapalha', () => {
    expect(validarInutilizacao({ ...base, notasNaFaixa: [{ numero: 9, status: 'autorizada' }] })).toEqual([]);
  });
  it('RN-FAT-01: justificativa de 15 a 255 caracteres', () => {
    expect(validarInutilizacao({ ...base, justificativa: 'curta' }).map((v) => v.campo)).toContain('justificativa');
  });
  it('RN-FAT-01: ano com 4 dígitos', () => {
    expect(validarInutilizacao({ ...base, ano: 26 }).map((v) => v.campo)).toContain('ano');
    expect(validarInutilizacao({ ...base, ano: 10000 }).map((v) => v.campo)).toContain('ano');
  });
  it('RN-FAT-01: rascunho e rejeitada dentro da faixa passam a inutilizada', () => {
    const notas = [
      { numero: 9, status: 'rejeitada' as const },
      { numero: 10, status: 'rejeitada' as const },
      { numero: 11, status: 'rascunho' as const },
      { numero: 12, status: 'denegada' as const },
    ];
    expect(notasInutilizadasPelaFaixa(10, 12, notas)).toEqual([10, 11]);
  });
});
