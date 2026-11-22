import { describe, expect, it } from 'vitest';
import { aplicarContingenciaAoConteudo, contaComoFaturada, modalidadeDaUf, prazoEpec, PRAZO_EPEC_HORAS, situacaoPrazoEpec, sugerirContingencia, podeTransmitirNaVolta, type TabelaSvc, transicaoEntradaContingencia, transicaoVoltaContingencia, validarEntradaContingencia } from './contingencia';
import type { ConteudoNota } from './tipos-nota';

const agora = new Date('2026-11-22T14:00:00Z');
const motivo = 'SEFAZ-AM fora do ar desde as 9h';
describe('contingência da NF-e (RN-FAT-05, 08, 09, 10)', () => {
  it('RN-FAT-05 (ADR 0011): a UF do emitente define o SVC pela tabela recebida (a do pacote nfe-sefaz entra pela API); UF fora da tabela (CE, PA, PI: só EPEC) dá nulo', () => {
    const tabelaDeTeste: TabelaSvc = { AM: 'svc_rs', SP: 'svc_an' };
    expect(modalidadeDaUf('AM', tabelaDeTeste)).toBe('svc_rs');
    expect(modalidadeDaUf(' sp ', tabelaDeTeste)).toBe('svc_an');
    expect(modalidadeDaUf('AM', { AM: 'svc_an' })).toBe('svc_an');
    for (const uf of ['CE', 'PA', 'PI', 'XX']) expect(modalidadeDaUf(uf, tabelaDeTeste)).toBeNull();
  });
  it('RN-FAT-05: entrada válida não tem violação', () => {
    expect(validarEntradaContingencia({ nfeSimulada: false, modalidade: 'svc_rs', motivo, inicioEm: new Date('2026-11-22T13:00:00Z'), agora })).toEqual([]);
  });
  it('RN-FAT-05: o operador informa o motivo de 15 a 256 caracteres, sem espaços nas pontas', () => {
    const base = { nfeSimulada: false, modalidade: 'epec' as const, inicioEm: agora, agora };
    expect(validarEntradaContingencia({ ...base, motivo: 'a'.repeat(14) })[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'motivo' });
    expect(validarEntradaContingencia({ ...base, motivo: 'a'.repeat(15) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, motivo: 'a'.repeat(256) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, motivo: 'a'.repeat(257) })).toHaveLength(1);
    expect(validarEntradaContingencia({ ...base, motivo: ' ' + 'a'.repeat(20) })[0]).toMatchObject({ campo: 'motivo' });
  });
  it('RN-FAT-05: inicioEm não pode estar no futuro (tolerância de 5 min) nem ser inválido', () => {
    const base = { nfeSimulada: false, modalidade: 'svc_an' as const, motivo, agora };
    expect(validarEntradaContingencia({ ...base, inicioEm: new Date(agora.getTime() + 4 * 60_000) })).toEqual([]);
    expect(validarEntradaContingencia({ ...base, inicioEm: new Date(agora.getTime() + 6 * 60_000) })[0]).toMatchObject({ campo: 'inicioEm' });
    expect(validarEntradaContingencia({ ...base, inicioEm: new Date('x') })[0]).toMatchObject({ campo: 'inicioEm' });
  });
  it('RN-FAT-08: aplicar grava (tpEmis e xJust no XML; número e série não mudam) tpEmis, dhCont e xJust sem mudar o conteúdo original', () => {
    const c = { natOp: 'Venda' } as unknown as ConteudoNota;
    const r = aplicarContingenciaAoConteudo(c, { modalidade: 'svc_rs', motivo: ` ${motivo} `, inicioEm: agora });
    expect(r.contingencia).toEqual({ tpEmis: 7, dhCont: '2026-11-22T14:00:00.000Z', xJust: motivo });
    expect(c.contingencia).toBeUndefined();
    expect(aplicarContingenciaAoConteudo(c, { modalidade: 'epec', motivo, inicioEm: agora }).contingencia?.tpEmis).toBe(4);
    expect(aplicarContingenciaAoConteudo(c, { modalidade: 'svc_an', motivo, inicioEm: agora }).contingencia?.tpEmis).toBe(6);
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
    const r = validarEntradaContingencia({ nfeSimulada: true, modalidade: 'svc_an', motivo, inicioEm: agora, agora });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rn: 'RN-FAT-10', campo: 'nfeSimulada' });
  });
  it('RN-FAT-05: FS-DA e modalidade desconhecida são recusadas', () => {
    const r = validarEntradaContingencia({ nfeSimulada: false, modalidade: 'FS-DA' as never, motivo, inicioEm: agora, agora });
    expect(r[0]).toMatchObject({ rn: 'RN-FAT-05', campo: 'modalidade' });
  });
  it('RN-FAT-08: SVC autorizada conta como faturada; EPEC só depois do evento vinculado', () => {
    expect(contaComoFaturada({ status: 'autorizada', tpEmis: 6 })).toBe(true);
    expect(contaComoFaturada({ status: 'autorizada', tpEmis: 7 })).toBe(true);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4 })).toBe(false);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: true })).toBe(true);
    expect(contaComoFaturada({ status: 'rejeitada', tpEmis: 6 })).toBe(false);
  });
  it('RN-FAT-08: EPEC com evento autorizado conta em todo status até cancelada/inutilizada/denegada (inclui retransmissão e rejeitada); sem evento nunca conta', () => {
    for (const status of ['emitida_contingencia', 'em_autorizacao', 'autorizada', 'autorizada_guarda_pendente', 'rejeitada'] as const) {
      expect(contaComoFaturada({ status, tpEmis: 4, epecAutorizado: true })).toBe(true);
    }
    for (const status of ['cancelada', 'inutilizada', 'denegada'] as const) {
      expect(contaComoFaturada({ status, tpEmis: 4, epecAutorizado: true })).toBe(false);
    }
    for (const status of ['emitida_contingencia', 'em_autorizacao', 'autorizada', 'rejeitada'] as const) {
      expect(contaComoFaturada({ status, tpEmis: 4 })).toBe(false);
      expect(contaComoFaturada({ status, tpEmis: 4, epecAutorizado: false })).toBe(false);
    }
  });
  it('RN-FAT-08: EPEC com evento autorizado conta como faturada antes da transmissão posterior (pendente de autorização); sem evento não conta', () => {
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: true })).toBe(true);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4, epecAutorizado: false })).toBe(false);
    expect(contaComoFaturada({ status: 'emitida_contingencia', tpEmis: 4 })).toBe(false);
    expect(contaComoFaturada({ status: 'autorizada', tpEmis: 4, epecAutorizado: true })).toBe(true);
  });
  it('RN-FAT-09: o prazo da EPEC é a autorização do EPEC mais 168 h (padrão) ou prazoHoras', () => {
    expect(PRAZO_EPEC_HORAS).toBe(168);
    const epecAutorizadoEm = new Date('2026-11-22T14:00:00Z');
    expect(prazoEpec({ epecAutorizadoEm }).toISOString()).toBe('2026-11-29T14:00:00.000Z');
    expect(prazoEpec({ epecAutorizadoEm, prazoHoras: 24 }).toISOString()).toBe('2026-11-23T14:00:00.000Z');
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
