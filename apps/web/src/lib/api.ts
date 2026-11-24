import { isIP } from 'node:net';
import { headers as cabecalhosDoPedido } from 'next/headers';
import type { z } from 'zod';
import { CABECALHO_CSRF_CONFIG, CABECALHO_IP_CLIENTE, CABECALHO_PROVA_BFF, CODIGO_TROCAR_SENHA, EuResposta, REGRAS_SENHA, type RegraSenhaId, type TrocarSenhaEntrada } from '@macuxierp/platform-sdk';
import { TrocarSenhaPendente } from './troca-pendente';
import { EU_FALSO, EU_FALSO_MEI, REFRESH_FALSO, TOKEN_FALSO } from './falso';

/** Cabeçalhos do POST JSON de entrada sem sessão (login e esqueci): o `CABECALHO_CSRF_CONFIG` do SDK vai sempre (ADR 0018). */
export const CABECALHOS_JSON_COM_CSRF: Readonly<Record<string, string>> = { 'content-type': 'application/json', [CABECALHO_CSRF_CONFIG]: '1' };

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
export class DadosInvalidos extends Error {
  override readonly name = 'DadosInvalidos' as const;
}
export class NaoAutenticado extends Error {
  override readonly name = 'NaoAutenticado' as const;
}
/** Falha que a tela resolve com redirect (renovar a sessão ou trocar a senha provisória): não vira mensagem nem valor de reserva. */
export function ehFalhaDeSessao(e: unknown): boolean {
  return e instanceof NaoAutenticado || e instanceof TrocarSenhaPendente;
}
export class SemPermissao extends Error {
  override readonly name = 'SemPermissao' as const;
}

/** Lança TrocarSenhaPendente se a resposta for o 403 `TROCAR_SENHA`; outros 403 (sem permissão) seguem como antes. */
async function conferirTroca(r: Response): Promise<Response> {
  if (r.status !== 403) return r;
  const j = (await r.clone().json().catch(() => null)) as { codigo?: unknown } | null;
  if (j?.codigo === CODIGO_TROCAR_SENHA) throw new TrocarSenhaPendente();
  return r;
}

/** `chamar` das rotas autenticadas do BKO (com Bearer): o 403 `TROCAR_SENHA` vira TrocarSenhaPendente. */
async function chamarAutenticado(url: string, init: RequestInit, timeoutMs = TIMEOUT_PADRAO_MS): Promise<Response> {
  return conferirTroca(await buscarNaApi(url, init, timeoutMs));
}

export interface Sessao {
  acesso: string;
  /** Valor "nome=valor" do cookie de refresh devolvido pela API (guardado httpOnly pelo shell). */
  refresh: string;
}

function base(): string {
  const url = process.env.MACUXIERP_API_URL; // lido na chamada (o portal /config e os testes ajustam a variável)
  if (!url) throw new ApiIndisponivel('MACUXIERP_API_URL não configurada');
  return url.replace(/\/$/, '');
}

/** Tempo padrão de uma chamada à API. */
export const TIMEOUT_PADRAO_MS = 10_000;

/** IP do navegador (`cf-connecting-ip` do pedido que o Next recebeu), só se for um IP válido. Fora de um pedido, ou sem IP válido, `null`. Nunca vai a log. */
async function ipDoPedido(): Promise<string | null> {
  try {
    const ip = (await cabecalhosDoPedido()).get('cf-connecting-ip')?.trim();
    return ip && isIP(ip) !== 0 ? ip : null;
  } catch {
    return null;
  }
}

/** Cabeçalhos do init sem nenhum `x-macuxierp-*` (nada forjado passa), salvo o CSRF do portal, que o próprio BFF põe; depois, a prova do BFF e o IP do cliente (T-0050). */
export async function cabecalhosParaApi(doInit: HeadersInit | undefined): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  new Headers(doInit).forEach((valor, nome) => {
    if (!nome.startsWith('x-macuxierp-') || nome === CABECALHO_CSRF_CONFIG) saida[nome] = valor;
  });
  const segredo = process.env.MACUXIERP_SEGREDO_BFF;
  if (segredo) saida[CABECALHO_PROVA_BFF] = segredo;
  const ip = await ipDoPedido();
  if (ip) saida[CABECALHO_IP_CLIENTE] = ip;
  return saida;
}

/** `fetch` à API com a base, o timeout, a prova do BFF e o IP do cliente, e o erro de indisponível. Comum ao BKO e ao portal /config (`lib/config/api.ts`). */
export async function buscarNaApi(url: string, init: RequestInit, timeoutMs = TIMEOUT_PADRAO_MS): Promise<Response> {
  try {
    const headers = await cabecalhosParaApi(init.headers);
    return await fetch(`${base()}${url}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiIndisponivel('API não respondeu');
  }
}

const chamar = buscarNaApi;

function lerSessao(r: Response, corpo: { token_acesso?: unknown }): Sessao {
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c?.includes('=')) ?? '';
  if (typeof corpo.token_acesso !== 'string' || !cookie) throw new ApiIndisponivel('resposta de sessão inválida');
  return { acesso: corpo.token_acesso, refresh: cookie };
}

/** Corpo de erro da API (`{ codigo, mensagem, campos }`): o texto do campo, se vier (ex.: 400 da carga em `campos.arquivos`), senão a mensagem. */
export async function textoDeErro(r: Response, campo?: string): Promise<{ codigo: string; texto: string }> {
  try {
    const j = (await r.json()) as { codigo?: unknown; mensagem?: unknown; campos?: Record<string, unknown> };
    const doCampo = campo ? j.campos?.[campo] : undefined;
    const texto = typeof doCampo === 'string' && doCampo.trim() ? doCampo.trim() : typeof j.mensagem === 'string' ? j.mensagem.trim() : '';
    return { codigo: typeof j.codigo === 'string' ? j.codigo : '', texto };
  } catch {
    return { codigo: '', texto: '' };
  }
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
  const r = await chamarAutenticado(caminho, { headers: { authorization: `Bearer ${acesso}` } });
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
    return process.env.MACUXIERP_FALSO_MEI === '1' ? EU_FALSO_MEI : EU_FALSO;
  }
  return getValidado('/v1/auth/eu', EuResposta, acesso, 'eu');
}

/** GET de um registro (detalhe, catálogo): como `getValidado` com status distintos; 404 vira `null`. Modo falso: `null`. */
export async function buscarRegistro<S extends z.ZodTypeAny>(caminho: string, schema: S, acesso: string, rotulo: string): Promise<z.infer<S> | null> {
  if (usaApiFalsa) return null;
  const r = await chamarAutenticado(caminho, { headers: { authorization: `Bearer ${acesso}` } });
  if (r.status === 401) throw new NaoAutenticado();
  if (r.status === 403) throw new SemPermissao();
  if (r.status === 404) return null;
  if (r.status === 400) throw new DadosInvalidos(`${rotulo}: VALIDACAO`);
  if (!r.ok) throw new ApiIndisponivel(`${rotulo}: HTTP ${r.status}`);
  const dados = schema.safeParse(await r.json().catch(() => null));
  if (!dados.success) throw new ApiIndisponivel(`${rotulo} fora do contrato`);
  return dados.data;
}

export interface RespostaEscrita {
  ok: boolean;
  status: number;
  /** Corpo JSON da API (resposta de sucesso ou erro `{ codigo, mensagem, campos }`); nunca vai a log. */
  corpo: unknown;
}

/** POST/PATCH/DELETE com JSON, Idempotency-Key e If-Match opcionais. Falha de rede lança ApiIndisponivel; 401 lança NaoAutenticado. */
export async function escreverJson(
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  caminho: string,
  corpo: unknown,
  acesso: string,
  opcoes: { idempotencia?: string; versao?: string; cookie?: string } = {},
): Promise<RespostaEscrita> {
  if (usaApiFalsa) throw new ApiIndisponivel('a escrita precisa da API real: configure MACUXIERP_API_URL');
  const cabecalhos: Record<string, string> = { authorization: `Bearer ${acesso}`, 'content-type': 'application/json' };
  if (opcoes.idempotencia) cabecalhos['idempotency-key'] = opcoes.idempotencia;
  if (opcoes.versao) cabecalhos['if-match'] = opcoes.versao;
  if (opcoes.cookie) cabecalhos.cookie = opcoes.cookie;
  const r = await chamarAutenticado(caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  if (r.status === 401) throw new NaoAutenticado();
  return { ok: r.ok, status: r.status, corpo: await r.json().catch(() => null) };
}

/** GET de um CSV na API (exportação da lista), com o token. Devolve o corpo e o tipo, ou `null` se a API falhar. Modo falso: `null`. */
export async function baixarCsv(caminho: string, acesso: string): Promise<{ corpo: ArrayBuffer; tipo: string } | null> {
  if (usaApiFalsa || !CAMINHO_CSV.test(caminho.split('?')[0] ?? '')) return null;
  const r = await chamarAutenticado(caminho, { headers: { authorization: `Bearer ${acesso}` } });
  if (r.status === 401) throw new NaoAutenticado();
  if (!r.ok) return null;
  return { corpo: await r.arrayBuffer(), tipo: r.headers.get('content-type') ?? 'text/csv; charset=utf-8' };
}
const CAMINHO_CSV = /^\/v1\/[a-z][a-z0-9-]*\/[a-z0-9/_-]+$/;

export type ArquivoBaixado = { ok: true; corpo: ArrayBuffer; tipo: string; nome: string } | { ok: false; status: number };

/** GET de um arquivo (XML, DANFE) com o token: o corpo passa pela memória e volta ao navegador. 404 e demais falhas viram `{ ok: false }` (a tela mostra mensagem fixa). Modo falso: 404. */
export async function baixarArquivo(caminho: string, acesso: string): Promise<ArquivoBaixado> {
  if (usaApiFalsa) return { ok: false, status: 404 };
  const r = await chamarAutenticado(caminho, { headers: { authorization: `Bearer ${acesso}` } });
  if (r.status === 401) throw new NaoAutenticado();
  if (!r.ok) return { ok: false, status: r.status };
  const nome = /filename="([A-Za-z0-9._-]{1,80})"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'arquivo';
  return { ok: true, corpo: await r.arrayBuffer(), tipo: r.headers.get('content-type') ?? 'application/octet-stream', nome };
}

/** `regras`: ids das regras que a API diz descumpridas (`detalhes.regras` do 400); o formulário marca ✗ nelas. */
export type ResultadoTrocaSenha = { ok: true } | { ok: false; campos: { senha_atual?: string; senha_nova?: string }; erro?: string; regras?: RegraSenhaId[] };

const SENHA_FALHA = 'Não foi possível trocar a senha agora. Tente de novo em instantes.';

/** Resposta de `POST /v1/auth/senha` em mensagem por campo: 400 `VALIDACAO` com `campos.senha_atual` ou `campos.senha_nova`. Nunca devolve o corpo cru. */
export function resultadoDaTrocaSenha(status: number, corpo: unknown): ResultadoTrocaSenha {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 400) {
    const c = (corpo as { campos?: Record<string, unknown> } | null)?.campos;
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const atual = texto(c?.senha_atual);
    const nova = texto(c?.senha_nova);
    const ids = (corpo as { detalhes?: { regras?: unknown } } | null)?.detalhes?.regras;
    const regras = Array.isArray(ids) ? REGRAS_SENHA.map((r) => r.id).filter((id) => ids.includes(id)) : [];
    if (atual || nova) {
      return { ok: false, campos: { ...(atual ? { senha_atual: atual } : {}), ...(nova ? { senha_nova: nova } : {}) }, ...(regras.length ? { regras } : {}) };
    }
  }
  if (status === 429) return { ok: false, campos: {}, erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
  return { ok: false, campos: {}, erro: SENHA_FALHA };
}

/**
 * POST /v1/auth/senha (204). A API revoga as OUTRAS sessões e só poupa a do cookie de refresh enviado: por isso o `refresh`
 * ("nome=valor") vai junto. Senhas só no corpo da chamada: nunca em log ou URL.
 */
export async function trocarSenha(acesso: string, refresh: string | undefined, corpo: TrocarSenhaEntrada): Promise<ResultadoTrocaSenha> {
  const r = await escreverJson('POST', '/v1/auth/senha', corpo, acesso, { ...(refresh ? { cookie: refresh } : {}) });
  return resultadoDaTrocaSenha(r.status, r.corpo);
}
