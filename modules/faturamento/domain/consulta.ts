import type { StatusNota } from '../contracts';

/** O que a SEFAZ disse sobre a chave na consulta de protocolo. */
export type SituacaoSefaz = 'autorizada' | 'cancelada' | 'denegada' | 'inexistente' | 'desconhecida';
export type AcaoConsulta = 'nenhuma' | 'guardar_xml_autorizado' | 'marcar_cancelada' | 'marcar_denegada' | 'pode_reenviar' | 'divergencia';

export interface EntradaConsulta {
  statusNota: StatusNota;
  cStat: string;
  /** tpEvento do evento que veio com o 135, quando houver: só 110111 cancela. */
  tipoEvento?: string;
}

export interface ResultadoConsulta {
  situacaoSefaz: SituacaoSefaz;
  acao: AcaoConsulta;
  /** Novo status a gravar; `null` = não mexe na nota. */
  novoStatus: StatusNota | null;
  /** `true` quando a mudança nasce de evento da SEFAZ (exigido por `validarTransicao` para `cancelada`). */
  porEvento: boolean;
  mensagem: string;
}

const CANCELADA = new Set(['101', '135', '155']);
const DENEGADA = new Set(['110', '301', '302', '303']);
const AINDA_NAO_AUTORIZADA: readonly StatusNota[] = ['em_autorizacao', 'rejeitada', 'emitida_contingencia', 'autorizada_guarda_pendente'];

const r = (situacaoSefaz: SituacaoSefaz, acao: AcaoConsulta, novoStatus: StatusNota | null, mensagem: string, porEvento = false): ResultadoConsulta => ({ situacaoSefaz, acao, novoStatus, porEvento, mensagem });

/**
 * Reconcilia o status local com o retorno da consulta de protocolo (RN-FAT-02, RN-FAT-03, RN-FAT-07).
 * Nota autorizada nunca é editada: só passa a `cancelada` quando a SEFAZ diz que foi cancelada (evento). Qualquer outra
 * discordância vira `divergencia` para o faturista/suporte, sem mudar a nota. `100` em nota ainda não autorizada pede
 * guardar o XML autorizado antes de qualquer outra coisa (regra 7).
 */
export function reconciliarConsulta(e: EntradaConsulta): ResultadoConsulta {
  const s = e.statusNota;
  if (e.cStat === '100') {
    if (s === 'autorizada' || s === 'cancelada') return r('autorizada', 'nenhuma', null, 'Nota autorizada na SEFAZ; nada a fazer.');
    if (AINDA_NAO_AUTORIZADA.includes(s)) return r('autorizada', 'guardar_xml_autorizado', 'autorizada', 'Autorizada na SEFAZ: guardar o XML autorizado antes de qualquer outra ação.');
    return r('autorizada', 'divergencia', null, `Autorizada na SEFAZ, mas a nota local está ${s}: verificar.`);
  }
  if (CANCELADA.has(e.cStat) && (e.cStat !== '135' || !e.tipoEvento || e.tipoEvento === '110111')) {
    if (s === 'cancelada') return r('cancelada', 'nenhuma', null, 'Já cancelada.');
    if (s === 'autorizada') return r('cancelada', 'marcar_cancelada', 'cancelada', 'Cancelamento homologado pela SEFAZ.', true);
    return r('cancelada', 'divergencia', null, `Cancelada na SEFAZ, mas a nota local está ${s}: verificar.`);
  }
  if (DENEGADA.has(e.cStat)) {
    if (s === 'denegada') return r('denegada', 'nenhuma', null, 'Já denegada.');
    if (s === 'em_autorizacao' || s === 'emitida_contingencia') return r('denegada', 'marcar_denegada', 'denegada', 'Uso denegado pela SEFAZ; o número fica consumido.');
    return r('denegada', 'divergencia', null, `Denegada na SEFAZ, mas a nota local está ${s}: verificar.`);
  }
  if (e.cStat === '217') {
    if (s === 'em_autorizacao' || s === 'rejeitada' || s === 'emitida_contingencia') return r('inexistente', 'pode_reenviar', null, 'SEFAZ não conhece a chave: o envio pode ser refeito com o mesmo número.');
    return r('inexistente', 'divergencia', null, `SEFAZ não conhece a chave, mas a nota local está ${s}: verificar com urgência.`);
  }
  return r('desconhecida', 'nenhuma', null, `cStat ${e.cStat} não reconhecido na consulta; nada alterado.`);
}
