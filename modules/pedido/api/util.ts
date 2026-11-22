import { PADRAO_RN, PADRAO_UUID, erros, type CamposErro, type ErroApi } from '@macuxierp/platform-sdk';
import type { Violacao } from '../domain';
import type { StatusPedido } from '../contracts';

/** Regra de negócio violada → 422 com o código da RN; referência e decisões "REF"/"D*" → 400 de validação. */
function erroDeViolacoes(v: readonly Violacao[]): ErroApi {
  const primeira = v[0];
  if (!primeira) throw new RangeError('erroDeViolacoes sem violação');
  const campos: CamposErro = Object.fromEntries(v.map((x) => [x.campo, x.mensagem]));
  return PADRAO_RN.test(primeira.rn) ? erros.regra(primeira.rn, primeira.mensagem, campos) : erros.validacao(campos);
}

export function exigir(v: readonly Violacao[]): void {
  if (v.length > 0) throw erroDeViolacoes(v);
}

export function idDe(params: Readonly<Record<string, string>>, nome = 'id'): string {
  const id = params[nome];
  if (!id || !PADRAO_UUID.test(id)) throw erros.naoEncontrado('Pedido');
  return id;
}

/** Fuso do tenant, uma constante só (premissa: America/Manaus até o core publicar o fuso por tenant): `dataNoFuso` e o SQL dos filtros de data. */
export const FUSO_TENANT = 'America/Manaus';
/** Data `AAAA-MM-DD` no fuso do tenant. */
export const dataNoFuso = (iso: string | Date, fuso: string = FUSO_TENANT): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso);

/** RN-PED-02: transição de status fora da tabela → 422 com `detalhes.possiveis` (lista). Única montagem: serviço, gatilho MXP02 e memória. */
export function erroTransicao(possiveis: readonly StatusPedido[], mensagem = 'Transição de status não permitida'): ErroApi {
  return erros.regra('RN-PED-02', mensagem, undefined, { possiveis: [...possiveis] });
}
