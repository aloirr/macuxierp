import { describe, expect, it } from 'vitest';
import { reconciliarConsulta } from './consulta';

describe('consulta de protocolo', () => {
  it('RN-FAT-03: 100 com nota ainda não autorizada manda guardar o XML autorizado antes de tudo', () => {
    expect(reconciliarConsulta({ statusNota: 'em_autorizacao', cStat: '100' })).toMatchObject({ situacaoSefaz: 'autorizada', acao: 'guardar_xml_autorizado', novoStatus: 'autorizada' });
    expect(reconciliarConsulta({ statusNota: 'rejeitada', cStat: '100' }).acao).toBe('guardar_xml_autorizado');
  });
  it('RN-FAT-02: 100 com nota já autorizada não muda nada', () => {
    expect(reconciliarConsulta({ statusNota: 'autorizada', cStat: '100' })).toMatchObject({ acao: 'nenhuma', novoStatus: null });
  });
  it('RN-FAT-02: 101, 135 e 155 passam a nota autorizada a cancelada (só por evento da SEFAZ)', () => {
    for (const c of ['101', '135', '155']) {
      const r = reconciliarConsulta({ statusNota: 'autorizada', cStat: c });
      expect(r).toMatchObject({ situacaoSefaz: 'cancelada', acao: 'marcar_cancelada', novoStatus: 'cancelada', porEvento: true });
    }
  });
  it('RN-FAT-02: 135 de outro evento (CC-e) não cancela', () => {
    expect(reconciliarConsulta({ statusNota: 'autorizada', cStat: '135', tipoEvento: '110110' })).toMatchObject({ acao: 'nenhuma', novoStatus: null });
  });
  it('RN-FAT-02: já cancelada fica como está', () => {
    expect(reconciliarConsulta({ statusNota: 'cancelada', cStat: '101' }).novoStatus).toBeNull();
  });
  it('RN-FAT-07: cancelada na SEFAZ com nota nunca autorizada localmente vira divergência, sem editar', () => {
    expect(reconciliarConsulta({ statusNota: 'em_autorizacao', cStat: '101' })).toMatchObject({ acao: 'divergencia', novoStatus: null });
  });
  it('RN-FAT-07: denegada (110, 301, 302, 303) marca denegada só a partir de em_autorizacao', () => {
    expect(reconciliarConsulta({ statusNota: 'em_autorizacao', cStat: '301' })).toMatchObject({ acao: 'marcar_denegada', novoStatus: 'denegada' });
    expect(reconciliarConsulta({ statusNota: 'autorizada', cStat: '301' })).toMatchObject({ acao: 'divergencia', novoStatus: null });
  });
  it('RN-FAT-02: 217 (inexistente) com nota autorizada é divergência grave; com em_autorizacao permite reenviar', () => {
    expect(reconciliarConsulta({ statusNota: 'autorizada', cStat: '217' })).toMatchObject({ situacaoSefaz: 'inexistente', acao: 'divergencia', novoStatus: null });
    expect(reconciliarConsulta({ statusNota: 'em_autorizacao', cStat: '217' })).toMatchObject({ acao: 'pode_reenviar', novoStatus: null });
  });
  it('RN-FAT-07: outro cStat é desconhecido e nada muda', () => {
    expect(reconciliarConsulta({ statusNota: 'autorizada', cStat: '999' })).toMatchObject({ situacaoSefaz: 'desconhecida', acao: 'nenhuma', novoStatus: null });
  });
});
