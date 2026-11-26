import { CABECALHO_CSRF_CONFIG, CAMINHO_LOGIN, COOKIE_CONFIG, LoginResposta, type LoginEntrada } from '@macuxierp/platform-sdk';
import { buscarNaApi, usaApiFalsaAgora } from './api';
import { CREDENCIAL_FALSA, REFRESH_FALSO, TOKEN_FALSO } from './falso';
import { erroDaApi, sinalDeBloqueioNaResposta, type ErrosLogin } from './login-regras';

/**
 * Login único (RN-CORE-12, ADR 0018): `POST /v1/auth/login` (`CAMINHO_LOGIN`), uma rota só para empresa e superadmin. O web
 * navega só pelo `destino` da resposta (`LoginResposta`): `bko` traz `token_acesso` no corpo e o refresh em cookie;
 * `config` traz só `expira_em` e o cookie `COOKIE_CONFIG`. Todo login leva o `CABECALHO_CSRF_CONFIG` (ADR 0018).
 * A troca obrigatória não vem do login (200 com a sessão aberta): quem chama lê `deve_trocar_senha` no `eu` do destino.
 */
export type SessaoAberta = { destino: 'bko'; acesso: string; refresh: string } | { destino: 'config'; token: string; expira_em: string };

export type ResultadoLogin =
  | { tipo: 'ok'; sessao: SessaoAberta }
  | { tipo: 'credencial' }
  | { tipo: 'bloqueada' }
  | { tipo: 'campos'; erros: ErrosLogin }
  | { tipo: 'indisponivel' };

function valorDoCookie(r: Response, nome?: string): string | undefined {
  const pares = r.headers.getSetCookie().map((c) => c.split(';')[0] ?? '').filter((c) => c.includes('='));
  return nome ? pares.find((c) => c.startsWith(`${nome}=`))?.slice(nome.length + 1) : pares[0];
}

function sessaoDe(r: Response, c: LoginResposta): SessaoAberta | null {
  if (c.destino === 'config') {
    const token = valorDoCookie(r, COOKIE_CONFIG);
    return token ? { destino: 'config', token, expira_em: c.expira_em } : null;
  }
  const refresh = valorDoCookie(r);
  return refresh ? { destino: 'bko', acesso: c.token_acesso, refresh } : null;
}

export async function loginUnico(entrada: LoginEntrada): Promise<ResultadoLogin> {
  if (usaApiFalsaAgora()) {
    const c = CREDENCIAL_FALSA;
    return entrada.empresa === c.empresa && entrada.email === c.email && entrada.senha === c.senha
      ? { tipo: 'ok', sessao: { destino: 'bko', acesso: TOKEN_FALSO, refresh: REFRESH_FALSO } }
      : { tipo: 'credencial' };
  }
  let r: Response;
  try {
    r = await buscarNaApi(CAMINHO_LOGIN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CABECALHO_CSRF_CONFIG]: '1' },
      body: JSON.stringify(entrada),
    });
  } catch {
    return { tipo: 'indisponivel' };
  }
  const corpo: unknown = await r.json().catch(() => null);
  if (sinalDeBloqueioNaResposta(r.status, corpo)) return { tipo: 'bloqueada' };
  const falha = erroDaApi(r.status, corpo);
  if (falha?.tipo === 'campos') return falha;
  if (r.status === 400) return { tipo: 'credencial' };
  if (r.status === 401 || r.status === 403) return { tipo: 'credencial' };
  if (!r.ok) return { tipo: 'indisponivel' };
  const c = LoginResposta.safeParse(corpo);
  const sessao = c.success ? sessaoDe(r, c.data) : null;
  return sessao ? { tipo: 'ok', sessao } : { tipo: 'indisponivel' };
}
