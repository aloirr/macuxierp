import type { StatusNota } from '../contracts';
import { violacao, type Violacao } from './violacao';

/**
 * Prazo padrão do cancelamento: 24 h da autorização (RN-FAT-02). Parametrizável (`prazoHoras`) porque a SEFAZ da UF
 * pode aceitar cancelamento extemporâneo (cStat 155, "homologado fora de prazo") até o limite que ela define, e o
 * estorno de nota fora do prazo depende de regra da UF e de aprovação do fiscal. O padrão é o conservador.
 */
export const PRAZO_CANCELAMENTO_HORAS = 24;

export const TAMANHO_JUSTIFICATIVA = { min: 15, max: 255 } as const;

/** Justificativa de evento (cancelamento e inutilização): 15 a 255 caracteres, sem espaços nas pontas. */
export function validarJustificativa(rn: string, texto: string): Violacao[] {
  const t = texto.trim();
  if (t.length < TAMANHO_JUSTIFICATIVA.min || t.length > TAMANHO_JUSTIFICATIVA.max)
    return [violacao(rn, 'justificativa', `A justificativa deve ter de ${TAMANHO_JUSTIFICATIVA.min} a ${TAMANHO_JUSTIFICATIVA.max} caracteres (sem espaços nas pontas).`)];
  return [];
}

export interface EntradaCancelamento {
  status: StatusNota;
  autorizadaEm: Date;
  agora: Date;
  justificativa: string;
  prazoHoras?: number;
}

export function validarCancelamento(e: EntradaCancelamento): Violacao[] {
  const v: Violacao[] = [];
  if (e.status === 'cancelada') v.push(violacao('RN-FAT-02', 'status', 'Nota já cancelada.'));
  else if (e.status !== 'autorizada') v.push(violacao('RN-FAT-02', 'status', `Só nota autorizada pode ser cancelada (status atual: ${e.status}).`));
  const horas = e.prazoHoras ?? PRAZO_CANCELAMENTO_HORAS;
  if (prazoDeCancelamentoEsgotado(e.autorizadaEm, e.agora, horas))
    v.push(violacao('RN-FAT-02', 'prazo', `Prazo de cancelamento de ${horas} h da autorização esgotado.`));
  v.push(...validarJustificativa('RN-FAT-02', e.justificativa));
  return v;
}

/** RN-FAT-02: o prazo de cancelamento (padrão 24 h da autorização, limite inclusive) esgotou? O worker confere de novo antes de transmitir. */
export const prazoDeCancelamentoEsgotado = (autorizadaEm: Date, agora: Date, prazoHoras: number = PRAZO_CANCELAMENTO_HORAS): boolean =>
  agora.getTime() - autorizadaEm.getTime() > prazoHoras * 3_600_000;
