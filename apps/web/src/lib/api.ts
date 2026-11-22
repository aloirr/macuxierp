import type { z } from 'zod';
import { EuResposta } from '@macuxierp/platform-sdk';
import { RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { CARGA_NAO_CONCLUIDA, SEM_PERMISSAO_CARGA } from './textos';
import { CREDENCIAL_FALSA, EU_FALSO, REFRESH_FALSO, TOKEN_FALSO } from './falso';

const URL_API = process.env.MACUXIERP_API_URL;

/** Modo falso só fora de produção e sem MACUXIERP_API_URL (nenhuma variável liga o falso em produção). */
const usaApiFalsa = !URL_API && process.env.NODE_ENV !== 'production';

/** Mesma regra do modo falso, para outros módulos do shell. */
export function usaApiFalsaAgora(): boolean {
  return usaApiFalsa;
}

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
export class SemPermissao extends Error {
  override readonly name = 'SemPermissao' as const;
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

/**
 * GET autenticado (Bearer) com a resposta validada por `schema`. 401 vira NaoAutenticado; falha ou corpo fora do contrato vira ApiIndisponivel.
 * Com `statusDistintos` (telas de lista), 403 vira SemPermissao e 400 vira DadosInvalidos; sem ele (ex.: buscarEu) ambos seguem como ApiIndisponivel.
 */
export async function getValidado<S extends z.ZodTypeAny>(
  caminho: string,
  schema: S,
  acesso: string,
  rotulo: string,
  statusDistintos = false,
): Promise<z.infer<S>> {
  const r = await chamar(caminho, { headers: { authorization: `Bearer ${acesso}` } });
  if (r.status === 401) throw new NaoAutenticado();
  if (statusDistintos && r.status === 403) throw new SemPermissao();
  if (statusDistintos && r.status === 400) throw new DadosInvalidos(`${rotulo}: VALIDACAO`);
  if (!r.ok) throw new ApiIndisponivel(`${rotulo}: HTTP ${r.status}`);
  let corpo: unknown;
  try {
    corpo = await r.json();
  } catch {
    throw new ApiIndisponivel(`${rotulo} fora do contrato`);
  }
  const dados = schema.safeParse(corpo);
  if (!dados.success) throw new ApiIndisponivel(`${rotulo} fora do contrato`);
  return dados.data;
}

/** GET /v1/auth/eu. Lança NaoAutenticado em 401. */
export async function buscarEu(acesso: string): Promise<EuResposta> {
  if (usaApiFalsa) {
    if (acesso !== TOKEN_FALSO) throw new NaoAutenticado();
    return EU_FALSO;
  }
  return getValidado('/v1/auth/eu', EuResposta, acesso, 'eu');
}

export type ResultadoCarga = { ok: true; relatorio: RelatorioCarga } | { ok: false; erro: string };

/**
 * POST /v1/cadastros/cargas (multipart, T-0026). O arquivo só passa pela memória; nada do conteúdo vai a log.
 * Devolve o relatório validado pelo contrato ou uma mensagem fixa (nunca o corpo de erro cru).
 */
export async function enviarCarga(acesso: string, formulario: FormData): Promise<ResultadoCarga> {
  if (usaApiFalsa) return { ok: false, erro: 'A carga precisa da API real: configure MACUXIERP_API_URL.' };
  const r = await chamar(PAGINA_CARGA.api, { method: 'POST', headers: { authorization: `Bearer ${acesso}` }, body: formulario });
  if (r.status === 401) throw new NaoAutenticado();
  if (r.status === 403) return { ok: false, erro: SEM_PERMISSAO_CARGA };
  if (r.status === 413) return { ok: false, erro: 'O envio é grande demais. Mande menos arquivos por vez.' };
  if (r.status === 400) return { ok: false, erro: (await mensagemDaApi(r)) || 'Envio inválido: confira os arquivos e o modo.' };
  if (!r.ok) return { ok: false, erro: CARGA_NAO_CONCLUIDA };
  const dados = RelatorioCarga.safeParse(await r.json().catch(() => null));
  return dados.success ? { ok: true, relatorio: dados.data } : { ok: false, erro: 'A API respondeu fora do contrato.' };
}
