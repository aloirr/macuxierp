import { describe, expect, it } from 'vitest';
import { aplicarContingenciaAoConteudo, contaComoFaturada, modalidadeDaUf, prazoEpec, situacaoPrazoEpec, sugerirContingencia, podeTransmitirNaVolta, TABELA_SVC_PADRAO, transicaoEntradaContingencia, transicaoVoltaContingencia, validarEntradaContingencia } from './contingencia';
import type { ConteudoNota } from './tipos-nota';

const agora = new Date('2026-11-22T14:00:00Z');
const xJust = 'SEFAZ-AM fora do ar desde as 9h';
describe('contingência da NF-e (RN-FAT-05, 08, 09, 10)', () => {
  it('RN-FAT-05: a UF do emitente define o SVC pela tabela recebida', () => {
    expect(modalidadeDaUf('AM', TABELA_SVC_PADRAO)).toBe('SVC-RS');
    expect(modalidadeDaUf(' sp ', TABELA_SVC_PADRAO)).toBe('SVC-AN');
    expect(modalidadeDaUf('AM', { AM: 'SVC-AN' })).toBe('SVC-AN');
    expect(modalidadeDaUf('XX', TABELA_SVC_PADRAO)).toBeNull();
  });
  it('RN-FAT-05: a tabela padrão cobre as 27 UFs', () => {
    expect(Object.keys(TABELA_SVC_PADRAO)).toHaveLength(27);
  });
  it('RN-FAT-05: entrada válida não tem violação', () => {
    expect(validarEntradaContingencia({ nfeSimulada: false, modalidade: 'SVC-RS', xJust, dhCont: new Date('2026-11-22T13:00:00Z'), agora })).toEqual([]);
  });
  it('RN-FAT-05: o operador informa xJust de 15 a 256 caracteres, sem espaços nas pontas', () => {
    const base = { nfeSimulada: false, modalidade: 'EPEC' as const, dhCont: agora, agora };
    expect(validarEntradaContingencia({ ...base, xJust: 'a'.repeat(14) })[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'xJust' });
    expect(validarEntradaContingencia({ ...base, xJust: 'a'.repeat(15) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, xJust: 'a'.repeat(256) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, xJust: 'a'.repeat(257) })).toHaveLength(1);
    expect(validarEntradaContingencia({ ...base, xJust: ' ' + 'a'.repeat(20) })[0]).toMatchObject({ campo: 'xJust' });
  });
  it('RN-FAT-05: dhCont não pode estar no futuro (tolerância de 5 min) nem ser inválido', () => {
    const base = { nfeSimulada: false, modalidade: 'SVC-AN' as const, xJust, agora };
    expect(validarEntradaContingencia({ ...base, dhCont: new Date(agora.getTime() + 4 * 60_000) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, dhCont: new Date(agora.getTime() + 6 * 60_000) })[0]).toMatchObject({ campo: 'dhCont' });
    expect(validarEntradaContingencia({ ...base, dhCont: new Date('x') })[0]).toMatchObject({ campo: 'dhCont' });
  });
  it('RN-FAT-08: aplicar grava (tpEmis e xJust no XML; número e série não mudam) tpEmis, dhCont e xJust sem mudar o conteúdo original', () => {
    const c = { natOp: 'Venda' } as unknown as ConteudoNota;
    const r = aplicarContingenciaAoConteudo(c, { modalidade: 'SVC-RS', xJust: ` ${xJust} `, dhCont: agora });
    expect(r.contingencia).toEqual({ tpEmis: 7, dhCont: '2026-11-22T14:00:00.000Z', xJust });
    expect(c.contingencia).toBeUndefined();
    expect(aplicarContingenciaAoConteudo(c, { modalidade: 'EPEC', xJust, dhCont: agora }).contingencia?.tpEmis).toBe(4);
    expect(aplicarContingenciaAoConteudo(c, { modalidade: 'SVC-AN', xJust, dhCont: agora }).contingencia?.tpEmis).toBe(6);
  });
  it('RN-FAT-09: na volta só transmite nota em contingência; EPEC exige o evento autorizado', () => {
    expect(podeTransmitirNaVolta({ status: 'emitida_contingencia', tpEmis: 4 })).toBe(false);
    expect(podeTransmitirNaVolta({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: true })).toBe(true);
    expect(podeTransmitirNaVolta({ status: 'emitida_contingencia', tpEmis: 6 })).toBe(true);
    expect(podeTransmitirNaVolta({ status: 'autorizada', tpEmis: 6 })).toBe(false);
    expect(podeTransmitirNaVolta({ status: 'emitida_contingencia', tpEmis: 1 })).toBe(false);
  });
  it('RN-FAT-09: transições de entrada e de volta usam a máquina de estados', () => {
    expect(transicaoEntradaContingencia('em_autorizacao')).toEqual([]);
    expect(transicaoEntradaContingencia('autorizada')[0]).toMatchObject({ rn: 'RN-FAT-02' });
    expect(transicaoVoltaContingencia({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: true })).toEqual([]);
    expect(transicaoVoltaContingencia({ status: 'emitida_contingencia', tpEmis: 4 })[0]).toMatchObject({ rn: 'RN-FAT-09' });
  });
  it('RN-FAT-05: o sistema sugere a contingência se a consulta de status estiver indisponível', () => {
    expect(sugerirContingencia({ consultaStatus: 'indisponivel', tentativasComTempoLimite: 0, limite: 3 })).toEqual({ sugerir: true, motivo: 'consulta_indisponivel' });
  });
  it('RN-FAT-05: o sistema sugere por tempo-limite ao atingir o limite de tentativas; sem sugestão abaixo dele', () => {
    expect(sugerirContingencia({ consultaStatus: 'ok', tentativasComTempoLimite: 3, limite: 3 })).toEqual({ sugerir: true, motivo: 'tempo_limite' });
    expect(sugerirContingencia({ consultaStatus: 'ok', tentativasComTempoLimite: 2, limite: 3 })).toEqual({ sugerir: false, motivo: 'nenhum' });
  });
  it('RN-FAT-05: limite inválido (zero ou negativo) nunca sugere por tempo-limite', () => {
    expect(sugerirContingencia({ consultaStatus: 'ok', tentativasComTempoLimite: 9, limite: 0 }).sugerir).toBe(false);
  });
  it('RN-FAT-10: filial com NF-e simulada não entra em contingência', () => {
    const r = validarEntradaContingencia({ nfeSimulada: true, modalidade: 'SVC-AN', xJust, dhCont: agora, agora });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rn: 'RN-FAT-10', campo: 'nfeSimulada' });
  });
  it('RN-FAT-05: FS-DA e modalidade desconhecida são recusadas', () => {
    const r = validarEntradaContingencia({ nfeSimulada: false, modalidade: 'FS-DA' as never, xJust, dhCont: agora, agora });
    expect(r[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'modalidade' });
  });
  it('RN-FAT-08: SVC autorizada conta como faturada; EPEC só depois do evento vinculado', () => {
    expect(contaComoFaturada({ status: 'autorizada', tpEmis: 6 })).toBe(true);
    expect(contaComoFaturada({ status: 'autorizada', tpEmis: 7 })).toBe(true);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4 })).toBe(false);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: true })).toBe(true);
    expect(contaComoFaturada({ status: 'em_autorizacao', tpEmis: 4, epecAutorizado: true })).toBe(false);
    expect(contaComoFaturada({ status: 'rejeitada', tpEmis: 6 })).toBe(false);
  });
  it('RN-FAT-09: o prazo da EPEC é a emissão mais prazoHoras (parâmetro)', () => {
    expect(prazoEpec({ emitidaEm: new Date('2026-11-22T14:00:00Z'), prazoHoras: 24 }).toISOString()).toBe('2026-11-23T14:00:00.000Z');
  });
  it('RN-FAT-09: situação do prazo: no prazo, perto do fim (janela de 6 h por padrão) e vencido', () => {
    const prazo = new Date('2026-11-23T14:00:00Z');
    expect(situacaoPrazoEpec(new Date('2026-11-23T07:59:00Z'), prazo)).toBe('no_prazo');
    expect(situacaoPrazoEpec(new Date('2026-11-23T08:00:00Z'), prazo)).toBe('perto_do_fim');
    expect(situacaoPrazoEpec(new Date('2026-11-23T14:00:00Z'), prazo)).toBe('perto_do_fim');
    expect(situacaoPrazoEpec(new Date('2026-11-23T14:00:01Z'), prazo)).toBe('vencido');
    expect(situacaoPrazoEpec(new Date('2026-11-23T12:00:00Z'), prazo, 1)).toBe('no_prazo');
  });
  it('RN-FAT-09: transição de volta mantém o número (a nota segue a máquina de estados, sem nova numeração)', () => {
    expect(transicaoVoltaContingencia({ status: 'emitida_contingencia', tpEmis: 6 })).toEqual([]);
  });
});
