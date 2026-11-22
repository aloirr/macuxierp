import { describe, expect, it } from 'vitest';
import { prazoDeCancelamentoEsgotado, validarCancelamento, PRAZO_CANCELAMENTO_HORAS } from './cancelamento';

const autorizadaEm = new Date('2026-11-20T12:00:00Z');
const base = { status: 'autorizada' as const, autorizadaEm, agora: new Date('2026-11-20T20:00:00Z'), justificativa: 'Cliente desistiu da compra' };

describe('cancelamento', () => {
  it('RN-FAT-02: nota autorizada dentro do prazo, com justificativa válida, não tem violação', () => {
    expect(validarCancelamento(base)).toEqual([]);
  });
  it('RN-FAT-02: o worker reconfere o prazo de 24 h antes de transmitir (limite inclusive, parametrizável)', () => {
    expect(prazoDeCancelamentoEsgotado(autorizadaEm, new Date('2026-11-21T12:00:00Z'))).toBe(false);
    expect(prazoDeCancelamentoEsgotado(autorizadaEm, new Date('2026-11-21T12:00:01Z'))).toBe(true);
    expect(prazoDeCancelamentoEsgotado(autorizadaEm, new Date('2026-11-22T12:00:00Z'), 168)).toBe(false);
  });
  it('RN-FAT-02: só nota autorizada cancela', () => {
    for (const s of ['rascunho', 'em_autorizacao', 'rejeitada', 'denegada', 'inutilizada', 'autorizada_guarda_pendente'] as const)
      expect(validarCancelamento({ ...base, status: s }).map((v) => v.campo)).toContain('status');
  });
  it('RN-FAT-02: nota já cancelada é violação', () => {
    const v = validarCancelamento({ ...base, status: 'cancelada' });
    expect(v[0]?.mensagem).toContain('já cancelada');
  });
  it('RN-FAT-02: prazo padrão de 24 h da autorização (limite inclusive)', () => {
    expect(PRAZO_CANCELAMENTO_HORAS).toBe(24);
    expect(validarCancelamento({ ...base, agora: new Date('2026-11-21T12:00:00Z') })).toEqual([]);
    expect(validarCancelamento({ ...base, agora: new Date('2026-11-21T12:00:01Z') }).map((v) => v.campo)).toContain('prazo');
  });
  it('RN-FAT-02: prazo parametrizável', () => {
    expect(validarCancelamento({ ...base, agora: new Date('2026-11-22T12:00:00Z'), prazoHoras: 168 })).toEqual([]);
  });
  it('RN-FAT-02: justificativa de 15 a 255 caracteres, sem espaços nas pontas', () => {
    expect(validarCancelamento({ ...base, justificativa: '  curta demais ' }).map((v) => v.campo)).toContain('justificativa');
    expect(validarCancelamento({ ...base, justificativa: 'x'.repeat(14) }).length).toBe(1);
    expect(validarCancelamento({ ...base, justificativa: 'x'.repeat(15) })).toEqual([]);
    expect(validarCancelamento({ ...base, justificativa: 'x'.repeat(255) })).toEqual([]);
    expect(validarCancelamento({ ...base, justificativa: 'x'.repeat(256) }).length).toBe(1);
  });
});
