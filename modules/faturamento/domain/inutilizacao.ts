import type { StatusNota } from '../contracts';
import { validarJustificativa } from './cancelamento';
import { violacao, type Violacao } from './violacao';

export const NUMERO_MIN = 1;
export const NUMERO_MAX = 999_999_999;
/** Limite da migração 0013: a faixa começa no máximo `proximo + 99` (100 números adiante). */
export const MAX_ADIANTE_DO_PROXIMO = 99;

export interface NotaNaFaixa { numero: number; status: StatusNota }

export interface EntradaInutilizacao {
  numeroInicial: number;
  numeroFinal: number;
  /** Próximo número da série/filial (o que seria emitido agora). */
  proximoNumero: number;
  /** Ano com 4 dígitos. */
  ano: number;
  justificativa: string;
  /** Notas da série/filial cujo número está na faixa (pode vir com outras; o domain filtra). */
  notasNaFaixa: readonly NotaNaFaixa[];
}

const BLOQUEIAM: readonly StatusNota[] = ['autorizada', 'cancelada', 'em_autorizacao'];
const naFaixa = (n: number, i: number, f: number) => n >= i && n <= f;

export function validarInutilizacao(e: EntradaInutilizacao): Violacao[] {
  const v: Violacao[] = [];
  const ok = (n: number) => Number.isInteger(n) && n >= NUMERO_MIN && n <= NUMERO_MAX;
  if (!ok(e.numeroInicial) || !ok(e.numeroFinal))
    v.push(violacao('RN-FAT-01', 'faixa', `Os números devem ser inteiros de ${NUMERO_MIN} a ${NUMERO_MAX}.`));
  else if (e.numeroInicial > e.numeroFinal) v.push(violacao('RN-FAT-01', 'faixa', 'O número inicial não pode ser maior que o final.'));
  if (e.numeroInicial > e.proximoNumero)
    v.push(violacao('RN-FAT-01', 'numeroInicial', `A faixa começa no máximo no próximo número (${e.proximoNumero}): não se abre buraco adiante.`));
  if (e.numeroFinal > e.proximoNumero + MAX_ADIANTE_DO_PROXIMO)
    v.push(violacao('RN-FAT-01', 'numeroFinal', `A faixa vai no máximo até o próximo número + ${MAX_ADIANTE_DO_PROXIMO} (${e.proximoNumero + MAX_ADIANTE_DO_PROXIMO}).`));
  if (!Number.isInteger(e.ano) || e.ano < 1000 || e.ano > 9999) v.push(violacao('RN-FAT-01', 'ano', 'O ano deve ter 4 dígitos.'));
  const bloqueadas = e.notasNaFaixa.filter((n) => naFaixa(n.numero, e.numeroInicial, e.numeroFinal) && BLOQUEIAM.includes(n.status));
  if (bloqueadas.length)
    v.push(violacao('RN-FAT-01', 'notasNaFaixa', `A faixa cobre nota autorizada, cancelada ou em autorização: ${bloqueadas.map((n) => `${n.numero} (${n.status})`).join(', ')}.`));
  v.push(...validarJustificativa('RN-FAT-01', e.justificativa));
  return v;
}

/** Números das notas `rascunho` ou `rejeitada` dentro da faixa, que passam a `inutilizada` quando o evento é registrado. */
export const notasInutilizadasPelaFaixa = (inicial: number, final: number, notas: readonly NotaNaFaixa[]): number[] =>
  notas.filter((n) => naFaixa(n.numero, inicial, final) && (n.status === 'rascunho' || n.status === 'rejeitada')).map((n) => n.numero);
