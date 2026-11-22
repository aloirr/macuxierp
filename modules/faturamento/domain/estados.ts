import type { StatusNota } from '../contracts';
import { violacao, type Violacao } from './violacao';

/**
 * Transições permitidas da nota (RN-FAT-02, RN-FAT-03, RN-FAT-07).
 * - `rejeitada` reenvia com o mesmo número (volta a `em_autorizacao`); se não será mais reenviada, o número só se fecha
 *   por inutilização (registro em `inutilizacao` que cobre o número, `numeroInutilizavel`); a nota passa a `inutilizada` (terminal) quando a inutilização é registrada;
 * - `autorizada` só vai a `cancelada`, e só por evento;
 * - `autorizada_guarda_pendente` só avança para `autorizada` (depois de guardar o XML).
 */
export const TRANSICOES: Readonly<Record<StatusNota, readonly StatusNota[]>> = {
  rascunho: ['em_autorizacao'],
  em_autorizacao: ['autorizada', 'autorizada_guarda_pendente', 'rejeitada', 'denegada', 'emitida_contingencia'],
  autorizada_guarda_pendente: ['autorizada'],
  autorizada: ['cancelada'],
  rejeitada: ['em_autorizacao', 'inutilizada'],
  inutilizada: [],
  denegada: [],
  cancelada: [],
  emitida_contingencia: ['em_autorizacao', 'autorizada', 'autorizada_guarda_pendente', 'rejeitada', 'denegada'],
};

export interface ContextoTransicao {
  /** `true` quando a mudança nasce de um evento fiscal registrado (cancelamento homologado pela SEFAZ). */
  porEvento?: boolean;
}

export function validarTransicao(de: StatusNota, para: StatusNota, ctx: ContextoTransicao = {}): Violacao[] {
  if (!TRANSICOES[de].includes(para)) {
    const rn = de === 'autorizada' || de === 'cancelada' || de === 'denegada' ? 'RN-FAT-02' : 'RN-FAT-07';
    return [violacao(rn, 'status', `Transição ${de} → ${para} não permitida (possíveis: ${TRANSICOES[de].join(', ') || 'nenhuma'}).`)];
  }
  if (para === 'cancelada' && !ctx.porEvento) {
    return [violacao('RN-FAT-02', 'status', 'Nota autorizada só vai a cancelada por evento de cancelamento.')];
  }
  return [];
}

/** RN-FAT-02: só rascunho e rejeitada aceitam edição de conteúdo; autorizada nunca é editada. */
export const podeEditar = (status: StatusNota): boolean => status === 'rascunho' || status === 'rejeitada';

/** RN-FAT-03: DANFE, e-mail, evento e integração só andam com a nota `autorizada` (XML já guardado). */
export const podeSeguirAposAutorizacao = (status: StatusNota): boolean => status === 'autorizada';

/** RN-FAT-07: o reenvio da rejeitada mantém série e número (nada de reservar outro). */
export const reenvioMantemNumero = (de: StatusNota, para: StatusNota): boolean => de === 'rejeitada' && para === 'em_autorizacao';

/**
 * RN-FAT-01: só a nota `rejeitada` (nunca autorizada, nunca denegada: a denegada consome o número) tem o número
 * fechado por inutilização quando o faturista desiste do reenvio. A inutilização é evento da série/faixa, não transição da nota.
 */
export const numeroInutilizavel = (status: StatusNota): boolean => status === 'rejeitada';
