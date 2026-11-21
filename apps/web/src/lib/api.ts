import { EuResposta } from '@macuxierp/platform-sdk';
import { CREDENCIAL_FALSA, EU_FALSO, REFRESH_FALSO, TOKEN_FALSO } from './falso';

const URL_API = process.env.MACUXIERP_API_URL;

/** Modo falso só fora de produção e sem MACUXIERP_API_URL (nenhuma variável liga o falso em produção). */
const usaApiFalsa = !URL_API && process.env.NODE_ENV !== 'production';

export class ApiIndisponivel extends Error {
  override readonly name = 'ApiIndisponivel' as const;
}
export class MuitasTentativas extends Error {
  override readonly name = 'MuitasTentativas' as const;
}
export class DadosInvalidos extends Error {
  override readonly name = 'DadosInvalidos' as const;
}
export class NaoAutenticado extends Error {
  override readonly name = 'NaoAutenticado' as const;
}

export interface Sessao {
  acesso: string;
  /** Valor "nome=valor" do cookie de refresh devolvido pela API (guardado httpOnly pelo shell). */
  refresh: string;
}

function base(): string {
  if (!URL_API) throw new ApiIndisponivel('MACUXIERP_API_URL não configurada');
  return URL_API.replace(/\/$/, '');
}

async function chamar(caminho: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base()}${caminho}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ApiIndisponivel('API não respondeu');
  }
}

function lerSessao(r: Response, corpo: { token_acesso?: unknown }): Sessao {
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c?.includes('=')) ?? '';
  if (typeof corpo.token_acesso !== 'string' || !cookie) throw new ApiIndisponivel('resposta de sessão inválida');
  return { acesso: corpo.token_acesso, refresh: cookie };
}

/** `mensagem` do corpo de erro da API (ou vazio, se o corpo não for o esperado). */
async function mensagemDaApi(r: Response): Promise<string> {
  try {
    const m = ((await r.json()) as { mensagem?: unknown }).mensagem;
    return typeof m === 'string' ? m.trim() : '';
  } catch {
    return '';
  }
}

/** POST /v1/auth/login. Null para credencial inválida (mensagem genérica). Lança MuitasTentativas (429) e DadosInvalidos (400). */
export async function entrar(empresa: string, email: string, senha: string): Promise<Sessao | null> {
  if (usaApiFalsa) {
    const c = CREDENCIAL_FALSA;
    return empresa === c.empresa && email === c.email && senha === c.senha ? { acesso: TOKEN_FALSO, refresh: REFRESH_FALSO } : null;
  }
  const r = await chamar('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ empresa, email, senha }),
  });
  if (r.status === 429) throw new MuitasTentativas(await mensagemDaApi(r));
  if (r.status === 400) throw new DadosInvalidos('login: VALIDACAO');
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new ApiIndisponivel(`login: HTTP ${r.status}`);
  return lerSessao(r, (await r.json()) as { token_acesso?: unknown });
}

/** POST /v1/auth/refresh. Null quando o refresh venceu ou foi revogado. */
export async function renovar(refresh: string): Promise<Sessao | null> {
  if (usaApiFalsa) return refresh === REFRESH_FALSO ? { acesso: TOKEN_FALSO, refresh } : null;
  const r = await chamar('/v1/auth/refresh', { method: 'POST', headers: { cookie: refresh } });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new ApiIndisponivel(`refresh: HTTP ${r.status}`);
  return lerSessao(r, (await r.json()) as { token_acesso?: unknown });
}

export async function sair(acesso: string, refresh: string): Promise<void> {
  if (usaApiFalsa) return;
  await chamar('/v1/auth/sair', { method: 'POST', headers: { authorization: `Bearer ${acesso}`, cookie: refresh } }).catch(() => undefined);
}

/** GET /v1/auth/eu. Lança NaoAutenticado em 401. */
export async function buscarEu(acesso: string): Promise<EuResposta> {
  if (usaApiFalsa) {
    if (acesso !== TOKEN_FALSO) throw new NaoAutenticado();
    return EU_FALSO;
  }
  const r = await chamar('/v1/auth/eu', { headers: { authorization: `Bearer ${acesso}` } });
  if (r.status === 401) throw new NaoAutenticado();
  if (!r.ok) throw new ApiIndisponivel(`eu: HTTP ${r.status}`);
  const dados = EuResposta.safeParse(await r.json());
  if (!dados.success) throw new ApiIndisponivel('resposta de /v1/auth/eu fora do contrato');
  return dados.data;
}
