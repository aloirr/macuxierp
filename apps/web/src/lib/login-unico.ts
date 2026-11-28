import { CABECALHO_CSRF_CONFIG, CAMINHO_LOGIN, CODIGO_EMPRESA_SUSPENSA, COOKIE_CONFIG, LoginResposta, type LoginEntrada } from '@macuxierp/platform-sdk';
import { buscarNaApi, usaApiFalsaAgora } from './api';
import { CREDENCIAL_FALSA, REFRESH_FALSO, TOKEN_FALSO } from './falso';
import { registrarFalha } from './falha-log';
import { erroDaApi, sinalDeBloqueioNaResposta, type ErrosLogin } from './login-regras';

/**
 * Login único (RN-CORE-12, ADR 0018): `POST /v1/auth/login` (`CAMINHO_LOGIN`), uma rota só, e-mail e senha, para empresa e superadmin (ADR 0021). O web
 * navega só pelo `destino` da resposta (`LoginResposta`): `bko` traz `token_acesso` no corpo e o refresh em cookie;
 * `config` traz só `expira_em` e o cookie `COOKIE_CONFIG`. Todo login leva o `CABECALHO_CSRF_CONFIG` (ADR 0018).
 * A troca obrigatória não vem do login (200 com a sessão aberta): quem chama lê `deve_trocar_senha` no `eu` do destino.
 */
export type SessaoAberta = { destino: 'bko'; acesso: string; refresh: string } | { destino: 'config'; token: string; expira_em: string };

export type ResultadoLogin =
  | { tipo: 'ok'; sessao: SessaoAberta }
  | { tipo: 'credencial' }
  /** 403 EMPRESA_SUSPENSA (ADR 0021 §3): só com a senha certa; a tela mostra o texto do SDK. */
  | { tipo: 'suspensa' }
  | { tipo: 'limite'; retry_after_s: number }
  | { tipo: 'bloqueada' }
  | { tipo: 'campos'; erros: ErrosLogin }
  /** 4xx com o envelope da API ({ codigo, mensagem }) fora dos já tratados (ex.: 422 REGRA_PLATAFORMA): a tela mostra a `mensagem` da API. */
  | { tipo: 'recusado'; mensagem: string }
  | { tipo: 'indisponivel' };

export function valorDoCookie(r: Response, nome?: string): string | undefined {
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

/** `indisponivel` nunca sem rastro: loga só o tipo (sem e-mail, senha ou token) e o build. */
function indisponivel(origem: string, erro: unknown): ResultadoLogin {
  registrarFalha(origem, erro);
  return { tipo: 'indisponivel' };
}

export async function loginUnico(entrada: LoginEntrada): Promise<ResultadoLogin> {
  if (usaApiFalsaAgora()) {
    const c = CREDENCIAL_FALSA;
    return entrada.email === c.email && entrada.senha === c.senha
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
    return { tipo: 'indisponivel' }; // `buscarNaApi` já registrou a falha
  }
  const corpo: unknown = await r.json().catch(() => null);
  if (sinalDeBloqueioNaResposta(r.status, corpo)) return { tipo: 'bloqueada' };
  const falha = erroDaApi(r.status, corpo);
  if (falha) return falha;
  if (r.status === 400) return { tipo: 'credencial' };
  if (r.status === 403 && (corpo as { codigo?: unknown } | null)?.codigo === CODIGO_EMPRESA_SUSPENSA) return { tipo: 'suspensa' };
  if (r.status === 401 || r.status === 403) return { tipo: 'credencial' };
  if (r.status >= 400 && r.status < 500) {
    const env = corpo as { codigo?: unknown; mensagem?: unknown } | null;
    const mensagem = typeof env?.mensagem === 'string' ? env.mensagem.trim() : '';
    const codigo = typeof env?.codigo === 'string' ? env.codigo : undefined;
    registrarFalha('login.status', { name: `HTTP_${r.status}`, code: codigo }); // só origem, status e código; nunca a mensagem
    return mensagem && codigo ? { tipo: 'recusado', mensagem: mensagem.slice(0, 300) } : { tipo: 'indisponivel' };
  }
  if (!r.ok) return indisponivel('login.status', { name: `HTTP_${r.status}` });
  const c = LoginResposta.safeParse(corpo);
  const sessao = c.success ? sessaoDe(r, c.data) : null;
  return sessao ? { tipo: 'ok', sessao } : indisponivel('login.resposta', { name: 'RespostaInvalida' });
}
