import {
  CADASTROS_CARGA_PORTAL, CAMPO_ARQUIVO_CARGA_PORTAL, CAMPO_FRASE_CARGA_PORTAL, CODIGO_TROCAR_SENHA, CODIGOS_ESTADO_MUDOU_ZERAR, CODIGO_ZERAGEM_BLOQUEADA, GravarCargaPlataformaEntrada, MENSAGENS_CARGA_PORTAL, PreviaZerarPlataformaEntrada, MAX_BYTES_ARQUIVO_CARGA_PORTAL, ModoCargaQuery, ZerarDadosPlataformaEntrada, PADRAO_UUID, nomeErrosCarga, nomeModeloCarga,
  type CadastroCargaPortal,
} from '@macuxierp/platform-sdk';
import { CARGA_GRANDE_DEMAIS, FALHA, SESSAO_EXPIRADA } from '../textos';
import { somaMantidos } from './cargas';
import { baixarErros, baixarModelo, gravarCarga, lerPreviaZerar, validarCarga, zerarCargas } from './cargas-api';
import { ErroPlataforma, mensagemDoErro } from './erros';
import { ROTA_SENHA } from './constantes';
import { ROTA_LOGIN } from '../rota-login';
import { tokenConfig } from './sessao';

/**
 * Lógica dos route handlers da aba Cargas (T-0058): o navegador chama o portal, o portal chama a API com o token do `mx_config`
 * e o cabeçalho anti-CSRF (feito em `api.ts`). Nada do arquivo vai a log; as respostas de erro levam só mensagem fixa.
 */

/** Folga do multipart (fronteiras e cabeçalhos das partes) acima do limite do arquivo. */
export const FOLGA_MULTIPART = 64 * 1024;
const LIMITE = MAX_BYTES_ARQUIVO_CARGA_PORTAL + FOLGA_MULTIPART;
export const SEM_CACHE = { 'cache-control': 'no-store' } as const;

export type AcaoCarga = 'validar' | 'gravar' | 'erros' | 'modelo';
export const ACOES_CARGA: readonly AcaoCarga[] = ['validar', 'gravar', 'erros', 'modelo'];
const CADASTROS = CADASTROS_CARGA_PORTAL.map((c) => c.cadastro) as readonly string[];

export const falha = (erro: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ ok: false, erro, ...extra }, { status, headers: SEM_CACHE });

/** Mesma regra do portal: atrás do túnel vale o primeiro `x-forwarded-host`; sem `Origin` (GET, curl) passa, a sessão é SameSite=Strict. */
function origemPermitida(req: Request): boolean {
  const origem = req.headers.get('origin');
  if (!origem) return true;
  try {
    const encaminhado = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    return new URL(origem).host === (encaminhado || req.headers.get('host'));
  } catch {
    return false;
  }
}

/** Lê o multipart em stream e corta ao passar do limite (o content-length pode mentir). Null se passou. */
async function lerComCorte(req: Request): Promise<FormData | null> {
  if (!req.body) return null;
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return new Response(new Blob(partes as BlobPart[]), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
}

type Resposta = Response | Promise<Response>;

/** Erro da API (ou da rede) vira resposta com mensagem fixa; 401 pede novo login e 403 TROCAR_SENHA leva à troca. */
function respostaDeErro(e: unknown): Response {
  const m = mensagemDoErro(e, 'carga');
  if (m.expirou) return falha(m.texto, 401, { redirecionar: ROTA_LOGIN });
  if (e instanceof ErroPlataforma && e.status === 403 && e.codigo === CODIGO_TROCAR_SENHA) return falha('Troque a senha provisória antes de continuar.', 403, { redirecionar: ROTA_SENHA });
  const status = e instanceof ErroPlataforma ? (e.status >= 400 && e.status < 500 ? e.status : 503) : 503;
  return falha(m.texto || FALHA, status, { chaveNova: m.chaveNova });
}

export async function comSessao(req: Request, fn: (token: string) => Resposta): Promise<Response> {
  if (!origemPermitida(req)) return falha('Origem não permitida.', 403);
  const token = await tokenConfig();
  if (!token) return falha(SESSAO_EXPIRADA, 401, { redirecionar: ROTA_LOGIN });
  try {
    return await fn(token);
  } catch (e) {
    return respostaDeErro(e);
  }
}

export const idValido = (id: string) => PADRAO_UUID.test(id);

/** `GET|POST /config/empresas/:id/cargas/:cadastro/:acao`: modelo é GET; validar, gravar e erros são POST com o arquivo. */
export async function tratarCarga(req: Request, id: string, cadastroBruto: string, acao: string): Promise<Response> {
  if (!CADASTROS.includes(cadastroBruto) || !idValido(id) || !(ACOES_CARGA as readonly string[]).includes(acao)) return falha('Não encontrado.', 404);
  const c = cadastroBruto as CadastroCargaPortal;
  if (acao === 'modelo' ? req.method !== 'GET' : req.method !== 'POST') return falha('Método não permitido.', 405);
  const resposta = await comSessao(req, async (token) => {
    if (acao === 'modelo') {
      const a = await baixarModelo(token, id, c);
      return new Response(a.corpo, { headers: { ...SEM_CACHE, 'content-type': a.tipo, 'content-disposition': `attachment; filename="${nomeModeloCarga(c)}"` } });
    }
    const modo = ModoCargaQuery.safeParse({ modo: new URL(req.url).searchParams.get('modo') ?? undefined });
    if (!modo.success) return falha('Envio inválido: confira o arquivo e tente de novo.', 400);
    const tamanho = Number(req.headers.get('content-length'));
    if (!req.headers.get('content-length') || !Number.isFinite(tamanho) || tamanho > LIMITE) return falha(CARGA_GRANDE_DEMAIS, 413);
    const formulario = await lerComCorte(req).catch(() => undefined);
    if (formulario === null) return falha(CARGA_GRANDE_DEMAIS, 413);
    const arquivo = formulario?.get(CAMPO_ARQUIVO_CARGA_PORTAL);
    if (!formulario || !(arquivo instanceof Blob)) return falha('Envio inválido: escolha o arquivo CSV.', 400);
    if (arquivo.size > MAX_BYTES_ARQUIVO_CARGA_PORTAL) return falha(CARGA_GRANDE_DEMAIS, 413);
    if (acao === 'validar') return Response.json({ ok: true, conferencia: await validarCarga(token, id, c, arquivo, modo.data.modo) }, { headers: SEM_CACHE });
    if (acao === 'erros') {
      const a = await baixarErros(token, id, c, arquivo);
      return new Response(a.corpo, { headers: { ...SEM_CACHE, 'content-type': a.tipo, 'content-disposition': `attachment; filename="${nomeErrosCarga(c)}"` } });
    }
    const chave = req.headers.get('idempotency-key') ?? '';
    const bruta = formulario.get(CAMPO_FRASE_CARGA_PORTAL);
    const frase = typeof bruta === 'string' ? bruta : undefined;
    // A frase é conferida pelo SDK (mesma regra da API); a API revalida.
    if (!PADRAO_UUID.test(chave) || !GravarCargaPlataformaEntrada.safeParse({ cadastro: c, modo: modo.data.modo, frase }).success) return falha('Envio inválido: confira o arquivo e a frase e tente de novo.', 400);
    return Response.json({ ok: true, gravacao: await gravarCarga(token, id, c, arquivo, chave, modo.data.modo, frase) }, { headers: SEM_CACHE });
  });
  return acao === 'modelo' && !resposta.ok ? await paginaDeErro(resposta, req) : resposta;
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * O Modelo é um link do navegador: se a API falhar, o erro não pode virar um arquivo (nem um JSON solto na tela).
 * Sessão ou senha pendente levam à página certa; o resto vira uma página curta com a mensagem e o status, sem anexo.
 */
async function paginaDeErro(r: Response, req: Request): Promise<Response> {
  const corpo = (await r.json().catch(() => ({}))) as { erro?: string; redirecionar?: string };
  if (corpo.redirecionar) return new Response(null, { status: 303, headers: { ...SEM_CACHE, location: new URL(corpo.redirecionar, req.url).toString() } });
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Modelo indisponível</title><body><p role="alert">${escapar(corpo.erro ?? FALHA)}</p></body></html>`;
  return new Response(html, { status: r.status, headers: { ...SEM_CACHE, 'content-type': 'text/html; charset=utf-8' } });
}

/** O 409 `MXC03` do zerar: os dados mudaram entre a prévia e o zerar. A API manda `detalhes.codigo` em um dos `CODIGOS_ESTADO_MUDOU_ZERAR` do SDK. */
export const CODIGO_DADOS_MUDARAM = 'dados_mudaram';

/** Guarda das rotas POST do Zerar: id inválido = 404, método diferente de POST = 405; `null` quando pode seguir. */
export function guardaPost(req: Request, id: string): Response | null {
  if (!idValido(id)) return falha('Não encontrado.', 404);
  if (req.method !== 'POST') return falha('Método não permitido.', 405);
  return null;
}

/** 409 do zerar: os dados mudaram entre a prévia e o zerar; o navegador refaz a prévia com chave nova. */
export const falhaDadosMudaram = (): Response => falha(MENSAGENS_CARGA_PORTAL.estadoMudouZerar, 409, { codigo: CODIGO_DADOS_MUDARAM, chaveNova: true });

/** `POST /config/empresas/:id/cargas/zerar`: corpo `{ cadastros, frase }`; a `Idempotency-Key` vai no cabeçalho. SDK confere a frase e a lista (a API revalida). */
export async function tratarZerar(req: Request, id: string): Promise<Response> {
  const barrada = guardaPost(req, id);
  if (barrada) return barrada;
  return comSessao(req, async (token) => {
    const bruto = (await req.json().catch(() => null)) as { cadastros?: unknown; frase?: unknown } | null;
    const chave = req.headers.get('idempotency-key') ?? '';
    const entrada = ZerarDadosPlataformaEntrada.safeParse({ cadastros: bruto?.cadastros, frase: typeof bruto?.frase === 'string' ? bruto.frase : '' });
    if (!entrada.success || !PADRAO_UUID.test(chave)) return falha('Escolha ao menos um cadastro e digite a frase para confirmar.', 400);
    let resultado;
    try {
      resultado = await zerarCargas(token, id, entrada.data.cadastros, entrada.data.frase, chave);
    } catch (e) {
      if (e instanceof ErroPlataforma && e.status === 422 && e.detalhes.codigo === CODIGO_ZERAGEM_BLOQUEADA) {
        return falha(MENSAGENS_CARGA_PORTAL.zeragemBloqueada, 422, { codigo: CODIGO_ZERAGEM_BLOQUEADA, bloqueios: e.detalhes.bloqueios ?? [], chaveNova: true });
      }
      if (e instanceof ErroPlataforma && e.status === 409 && (CODIGOS_ESTADO_MUDOU_ZERAR as readonly string[]).includes(String(e.detalhes.codigo))) return falhaDadosMudaram();
      throw e;
    }
    return Response.json({ ok: true, mantidos: somaMantidos(resultado.mantidos) }, { headers: SEM_CACHE });
  });
}

/** `POST /config/empresas/:id/cargas/zerar/previa`: corpo `{ cadastros }`; devolve a `ZeragemPlataformaResposta` da API (só leitura, sem chave nem frase). */
export async function tratarPreviaZerar(req: Request, id: string): Promise<Response> {
  const barrada = guardaPost(req, id);
  if (barrada) return barrada;
  return comSessao(req, async (token) => {
    const bruto = (await req.json().catch(() => null)) as { cadastros?: unknown } | null;
    const entrada = PreviaZerarPlataformaEntrada.safeParse({ cadastros: bruto?.cadastros });
    if (!entrada.success) return falha('Escolha ao menos um cadastro.', 400);
    return Response.json({ ok: true, previa: await lerPreviaZerar(token, id, entrada.data.cadastros) }, { headers: SEM_CACHE });
  });
}
