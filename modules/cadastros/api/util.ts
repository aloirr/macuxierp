import { ErroApi, erros, type CamposErro, type EntradaRota } from '@macuxierp/platform-sdk';
import { PADRAO_UUID } from '@macuxierp/platform-sdk';
import type { Violacao } from '../domain';

/** Regra de negócio violada → 422 com o código da RN; decisões "D*" (configuração) → 400 de validação. */
export function erroDeViolacoes(v: readonly Violacao[]): ErroApi {
  const primeira = v[0];
  if (!primeira) throw new RangeError('erroDeViolacoes sem violação');
  const campos: CamposErro = Object.fromEntries(v.map((x) => [x.campo, x.mensagem]));
  return /^RN-[A-Z]+-\d{2}$/.test(primeira.rn) ? erros.regra(primeira.rn, primeira.mensagem, campos) : erros.validacao(campos);
}

export function exigir(v: readonly Violacao[]): void {
  if (v.length > 0) throw erroDeViolacoes(v);
}

export function idDe(e: EntradaRota<unknown, unknown>, nome = 'id'): string {
  const id = e.params[nome];
  if (!id || !PADRAO_UUID.test(id)) throw erros.naoEncontrado('Registro');
  return id;
}

export const dataIso = (d: Date): string => d.toISOString().slice(0, 10);
