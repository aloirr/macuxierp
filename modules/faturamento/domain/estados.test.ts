import { describe, expect, it } from 'vitest';
import { StatusNota } from '../contracts';
import { numeroInutilizavel, podeEditar, podeSeguirAposAutorizacao, reenvioMantemNumero, TRANSICOES, validarTransicao } from './estados';

describe('máquina de estados da nota', () => {
  it('RN-FAT-07: rejeitada reenvia com o mesmo número', () => {
    expect(validarTransicao('rejeitada', 'em_autorizacao')).toEqual([]);
    expect(reenvioMantemNumero('rejeitada', 'em_autorizacao')).toBe(true);
    expect(reenvioMantemNumero('rascunho', 'em_autorizacao')).toBe(false);
  });
  it('RN-FAT-02: autorizada só vai a cancelada, e só por evento', () => {
    expect(validarTransicao('autorizada', 'cancelada')[0]).toMatchObject({ rn: 'RN-FAT-02' });
    expect(validarTransicao('autorizada', 'cancelada', { porEvento: true })).toEqual([]);
    for (const para of StatusNota.options.filter((s) => s !== 'cancelada')) {
      expect(validarTransicao('autorizada', para, { porEvento: true })[0]).toMatchObject({ rn: 'RN-FAT-02' });
    }
  });
  it('RN-FAT-02: nota autorizada nunca é editada; só rascunho e rejeitada editam', () => {
    expect(StatusNota.options.filter(podeEditar)).toEqual(['rascunho', 'rejeitada']);
  });
  it('RN-FAT-03: guarda pendente só avança para autorizada e nada segue antes da guarda', () => {
    expect(TRANSICOES.autorizada_guarda_pendente).toEqual(['autorizada']);
    expect(StatusNota.options.filter(podeSeguirAposAutorizacao)).toEqual(['autorizada']);
  });
  it('RN-FAT-02: cancelada e denegada são terminais', () => {
    expect(validarTransicao('cancelada', 'autorizada')[0]).toMatchObject({ rn: 'RN-FAT-02' });
  });
  it('RN-FAT-05: contingência transmitida depois segue o fluxo normal', () => {
    expect(validarTransicao('em_autorizacao', 'emitida_contingencia')).toEqual([]);
    expect(validarTransicao('emitida_contingencia', 'em_autorizacao')).toEqual([]);
    expect(validarTransicao('rascunho', 'autorizada')[0]).toMatchObject({ rn: 'RN-FAT-07' });
  });
  it('RN-FAT-01 e RN-FAT-07: rejeitada abandonada passa a inutilizada (terminal) quando a inutilização é registrada', () => {
    expect(StatusNota.options).toContain('inutilizada');
    expect(validarTransicao('rejeitada', 'inutilizada')).toEqual([]);
    expect(TRANSICOES.inutilizada).toEqual([]);
    expect(validarTransicao('inutilizada', 'em_autorizacao')[0]).toMatchObject({ rn: 'RN-FAT-07' });
    for (const de of StatusNota.options.filter((s) => s !== 'rejeitada')) {
      expect(validarTransicao(de, 'inutilizada')[0]).toBeDefined();
    }
  });
  it('RN-FAT-01: só a rejeitada tem o número inutilizável (condição da transição para inutilizada)', () => {
    expect(StatusNota.options.filter(numeroInutilizavel)).toEqual(['rejeitada']);
    expect(validarTransicao('rejeitada', 'cancelada', { porEvento: true })[0]).toMatchObject({ rn: 'RN-FAT-07' });
    expect(validarTransicao('rejeitada', 'autorizada')[0]).toMatchObject({ rn: 'RN-FAT-07' });
  });
});
