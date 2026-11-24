import { CAMINHOS_ESQUECI_SENHA, PedirSenhaTemporariaEntrada, SituacaoEsqueciResposta } from '@macuxierp/platform-sdk';
import { buscarNaApi, usaApiFalsaAgora } from './api';
import { interpretarEsqueci, TEXTOS_ESQUECI, type ResultadoEsqueci } from './esqueci-resultado';
import { validarComSdk } from './login-regras';

/** Só no servidor (leva a prova do BFF e o IP do cliente ao limite por IP). Sem API configurada (fixture, fora de produção) o link aparece e o pedido responde neutro. */

/** `GET /v1/auth/esqueci/situacao`: falha de qualquer tipo = indisponível (o link some). */
export async function lerSituacaoEsqueci(): Promise<boolean> {
  if (usaApiFalsaAgora()) return true;
  try {
    const r = await buscarNaApi(CAMINHOS_ESQUECI_SENHA.situacao, { method: 'GET' });
    if (!r.ok) return false;
    const p = SituacaoEsqueciResposta.safeParse(await r.json());
    return p.success && p.data.esqueci_disponivel;
  } catch {
    return false;
  }
}

/** `POST /v1/auth/esqueci`: para todos; a API desvia o código reservado por dentro. */
export async function pedirSenhaTemporaria(entrada: { empresa: string; email: string }): Promise<ResultadoEsqueci> {
  const v = validarComSdk(PedirSenhaTemporariaEntrada, ['empresa', 'email'], entrada);
  if (!v.ok) return { tipo: 'campos', erros: v.erros };
  if (usaApiFalsaAgora()) return { tipo: 'ok' };
  try {
    const r = await buscarNaApi(CAMINHOS_ESQUECI_SENHA.tenant, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v.dados) });
    return interpretarEsqueci(r.status, await r.json().catch(() => null));
  } catch {
    return { tipo: 'erro', texto: TEXTOS_ESQUECI.erroGenerico };
  }
}
