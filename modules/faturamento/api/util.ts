import { erros, PADRAO_RN, PADRAO_UUID, type ErroApi, type Violacao } from '@macuxierp/platform-sdk';

/** Regra de negócio violada (RN-XXX-NN) → 422 com o código da RN; o resto (RF-..., decisões) → 400 de validação. */
export function erroDeViolacoes(v: readonly Violacao[]): ErroApi {
  const primeira = v[0];
  if (!primeira) throw new RangeError('erroDeViolacoes sem violação');
  const campos = Object.fromEntries(v.map((x) => [x.campo, x.mensagem]));
  return PADRAO_RN.test(primeira.rn) ? erros.regra(primeira.rn, primeira.mensagem, campos) : erros.validacao(campos);
}

export function idDe(params: Readonly<Record<string, string>>, nome = 'id'): string {
  const id = params[nome];
  if (!id || !PADRAO_UUID.test(id)) throw erros.naoEncontrado('Nota');
  return id;
}
