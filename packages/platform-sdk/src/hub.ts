/**
 * Porta HTTP do Hub do Macuxi FDV (`/integracao/v1`, docs/produto/06; desenho T-0009 §5, §6 e §6.1). O módulo
 * `integracao-fdv` recebe o `ClienteHub` pronto do `apps/worker` (não abre conexão nem monta URL); o adaptador real é
 * o `criarClienteHub`.
 *
 * Garantias do adaptador:
 * - **Sem URL livre (anti-SSRF)**: a base vem só da lista fixa `urls` por ambiente, na configuração do worker; o
 *   `caminho` é relativo a `/integracao/v1`, começa com `/` e não traz host, esquema, `..` nem `%2e`. Redirecionamento
 *   não é seguido (vira `recusa`).
 * - **Pedido inválido** (corpo que não vira JSON, `Idempotency-Key` fora de ASCII visível ou acima de 255): erro
 *   `ErroClienteHub('pedido_invalido')` antes da rede, nunca `retentavel` (repetir não conserta).
 * - **Cabeçalhos** (§6): `Authorization: Bearer <chave>`, `X-Macuxi-Conector-Id`, `X-Macuxi-Conector-Versao` fixo em
 *   `VERSAO_CONECTOR_HUB` (P-2, opção A: o nível de compatibilidade de Conector, nunca a versão do ERP),
 *   `User-Agent: macuxierp/<versão do ERP>` e `Idempotency-Key` quando o pedido traz.
 * - **Classificação** da resposta: 2xx `ok` (com `replay` pelo cabeçalho `Idempotent-Replay: true`); rede, timeout,
 *   5xx e 429 `retentavel` (com o `Retry-After` em ms, no máximo 1 h); demais (3xx e 4xx) `recusa`. Corpo de resposta
 *   acima de `LIMITE_RESPOSTA_HUB_BYTES` (pelo `content-length` ou contando o fluxo) vira `codigo` 'resposta_grande':
 *   `retentavel` em 5xx e 429, `recusa` no resto (inclusive 2xx). O `codigo` sai do corpo JSON de
 *   erro do Hub (`codigo` ou `erro.codigo`), só se for curto e em `[a-z0-9_]`; a mensagem e o corpo de erro do Hub nunca
 *   saem do adaptador (podem citar valor ou ecoar a chave).
 * - **Sem curva de retentativa**: quanto esperar é regra do `domain` do `integracao-fdv` (T-0009 §5); a porta só
 *   classifica e entrega o `retryAfterMs`.
 * - **Credencial só em memória**: a chave não entra em mensagem de erro, `toString`, log nem na resposta (que não
 *   carrega os cabeçalhos do pedido). Erro do `fetch` vira `retentavel` sem a mensagem original.
 */

export type AmbienteHub = 'teste' | 'producao';
export const AMBIENTES_HUB: readonly AmbienteHub[] = ['teste', 'producao'];

/** Credencial do conector, decifrada pelo worker só na hora da chamada (§6). */
export interface CredencialHub {
  conectorId: string;
  chave: string;
  ambiente: AmbienteHub;
}

export interface PedidoHub {
  metodo: 'GET' | 'POST';
  /** Relativo a `/integracao/v1` (ex.: `/lotes`, `/sinal`). */
  caminho: string;
  corpo?: unknown;
  chaveIdempotencia?: string;
  timeoutMs?: number;
}

export type RespostaHub =
  /** 2xx. `corpo` nulo quando vazio ou não-JSON; `replay` = o Hub devolveu a resposta guardada da mesma `Idempotency-Key`. */
  | { tipo: 'ok'; status: number; corpo: unknown; replay: boolean }
  /** Rede (`codigo` 'rede'), timeout ('timeout'), 5xx e 429: o módulo adia pela curva do Hub (domain, §5). */
  | { tipo: 'retentavel'; status: number | null; codigo: string | null; retryAfterMs: number | null }
  /**
   * Demais 4xx (e 3xx): o módulo decide pausar pelo `status` e `codigo` (§5). Sem corpo nem mensagem (podem ecoar a chave).
   * Também 2xx com corpo acima do limite (`codigo` 'resposta_grande').
   */
  | { tipo: 'recusa'; status: number; codigo: string | null };

export interface ClienteHub {
  chamar(cred: CredencialHub, pedido: PedidoHub): Promise<RespostaHub>;
}

/** Nível de compatibilidade de Conector que o ERP implementa (decisão P-2, opção A). */
export const VERSAO_CONECTOR_HUB = '1.4.0';

const TIMEOUT_PADRAO_MS = 15_000;
const PADRAO_CODIGO = /^[a-z0-9_]{1,64}$/;
const PADRAO_CONECTOR = /^[A-Za-z0-9_-]{1,64}$/;
/** Chave do conector: ASCII visível (vai num cabeçalho; nada de espaço nem quebra de linha). */
const PADRAO_CHAVE = /^[\x21-\x7e]{1,512}$/;
/** `Idempotency-Key`: ASCII visível, até 255 (vai num cabeçalho). */
const PADRAO_IDEMPOTENCIA = /^[\x21-\x7e]{1,255}$/;
/** Teto do `Retry-After` aceito do Hub: 1 h. */
export const RETRY_AFTER_MAXIMO_MS = 3_600_000;
/** Maior corpo de resposta lido do Hub: 4 MiB. */
export const LIMITE_RESPOSTA_HUB_BYTES = 4 * 1024 * 1024;

/** Erro de uso da porta (programação ou configuração). A mensagem é fixa: nunca cita chave, caminho nem URL. */
export class ErroClienteHub extends Error {
  override readonly name = 'ErroClienteHub';
  constructor(readonly codigo: 'url_invalida' | 'caminho_invalido' | 'credencial_invalida' | 'ambiente_invalido' | 'pedido_invalido') {
    super(`cliente do Hub: ${codigo}`);
  }
}

/**
 * Base `https://host[:porta][/prefixo]`, sem credencial, consulta nem fragmento. Devolve sem a barra final e sem o
 * `/integracao/v1` final (o cliente o acrescenta): a configuração pode trazer a URL do Hub como no doc 06
 * (`https://api.macuxifdv.com.br/integracao/v1`) sem dobrar o prefixo.
 */
export function validarUrlHub(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErroClienteHub('url_invalida');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new ErroClienteHub('url_invalida');
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/integracao\/v1$/, '')}`;
}

function caminhoValido(caminho: string): boolean {
  return (
    caminho.startsWith('/') &&
    !caminho.startsWith('//') &&
    !caminho.includes('://') &&
    !caminho.includes('..') &&
    !caminho.includes('\\') &&
    !caminho.includes('#') &&
    !caminho.includes('@') &&
    !/%2e/i.test(caminho) &&
    /^[\x21-\x7e]+$/.test(caminho)
  );
}

/** `Retry-After` em segundos ou data HTTP → ms (de 0 a `RETRY_AFTER_MAXIMO_MS`). Ausente ou ilegível → null. */
export function retryAfterEmMs(valor: string | null, agoraMs: number): number | null {
  if (!valor) return null;
  const v = valor.trim();
  if (/^\d+$/.test(v)) return Math.min(RETRY_AFTER_MAXIMO_MS, Number(v) * 1000);
  const data = Date.parse(v);
  return Number.isNaN(data) ? null : Math.min(RETRY_AFTER_MAXIMO_MS, Math.max(0, data - agoraMs));
}

/** `codigo` (ou `erro.codigo`) do corpo de erro do Hub, só se curto e em `[a-z0-9_]`. */
export function codigoDoCorpo(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as { codigo?: unknown; erro?: unknown };
  const erro = c.erro && typeof c.erro === 'object' ? (c.erro as { codigo?: unknown }).codigo : undefined;
  for (const x of [c.codigo, erro]) if (typeof x === 'string' && PADRAO_CODIGO.test(x)) return x;
  return null;
}

/** Corpo como texto, até `limite` bytes (pelo `content-length` e contando o fluxo). Acima → null (o resto é descartado). */
async function textoLimitado(r: Response, limite: number): Promise<string | null> {
  const declarado = r.headers.get('content-length')?.trim();
  if (declarado && /^\d+$/.test(declarado) && Number(declarado) > limite) {
    await r.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!r.body) return '';
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8');
}

function jsonOuNulo(texto: string): unknown {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

export interface OpcoesClienteHub {
  /** Base fixa por ambiente (https), da configuração do worker. */
  urls: Record<AmbienteHub, string>;
  /** Versão do ERP: vai só no `User-Agent`. */
  versaoErp: string;
  fetch?: typeof fetch;
  timeoutPadraoMs?: number;
}

export function criarClienteHub(opts: OpcoesClienteHub): ClienteHub {
  const bases = Object.fromEntries(AMBIENTES_HUB.map((a) => [a, validarUrlHub(opts.urls[a])])) as Record<AmbienteHub, string>;
  const buscar = opts.fetch ?? globalThis.fetch;
  const timeoutPadrao = opts.timeoutPadraoMs ?? TIMEOUT_PADRAO_MS;
  const agente = `macuxierp/${opts.versaoErp}`;

  return Object.freeze({
    async chamar(cred: CredencialHub, pedido: PedidoHub): Promise<RespostaHub> {
      if (!AMBIENTES_HUB.includes(cred.ambiente)) throw new ErroClienteHub('ambiente_invalido');
      if (!PADRAO_CONECTOR.test(cred.conectorId) || !PADRAO_CHAVE.test(cred.chave)) throw new ErroClienteHub('credencial_invalida');
      if (!caminhoValido(pedido.caminho)) throw new ErroClienteHub('caminho_invalido');
      const base = bases[cred.ambiente];
      const url = new URL(`${base}/integracao/v1${pedido.caminho}`);
      // defesa em profundidade: a URL montada continua no host e no prefixo da lista fixa
      if (`${url.origin}${url.pathname}`.indexOf(`${base}/integracao/v1/`) !== 0) throw new ErroClienteHub('caminho_invalido');

      const cabecalhos: Record<string, string> = {
        Authorization: `Bearer ${cred.chave}`,
        'X-Macuxi-Conector-Id': cred.conectorId,
        'X-Macuxi-Conector-Versao': VERSAO_CONECTOR_HUB,
        'User-Agent': agente,
        Accept: 'application/json',
      };
      if (pedido.chaveIdempotencia !== undefined) {
        if (!PADRAO_IDEMPOTENCIA.test(pedido.chaveIdempotencia)) throw new ErroClienteHub('pedido_invalido');
        cabecalhos['Idempotency-Key'] = pedido.chaveIdempotencia;
      }
      // serializa antes da rede: corpo que não vira JSON (BigInt, ciclo) é erro do pedido, não falha retentável
      let corpoJson: string | undefined;
      if (pedido.corpo !== undefined) {
        try {
          corpoJson = JSON.stringify(pedido.corpo);
        } catch {
          throw new ErroClienteHub('pedido_invalido');
        }
        if (typeof corpoJson !== 'string') throw new ErroClienteHub('pedido_invalido');
        cabecalhos['Content-Type'] = 'application/json';
      }

      const controle = new AbortController();
      let estourou = false;
      const relogio = setTimeout(() => {
        estourou = true;
        controle.abort();
      }, pedido.timeoutMs ?? timeoutPadrao);
      try {
        const r = await buscar(url, {
          method: pedido.metodo,
          headers: cabecalhos,
          body: corpoJson,
          redirect: 'manual',
          signal: controle.signal,
        });
        const retentavel = r.status === 429 || r.status >= 500;
        const texto = await textoLimitado(r, LIMITE_RESPOSTA_HUB_BYTES);
        if (texto === null) {
          return retentavel
            ? { tipo: 'retentavel', status: r.status, codigo: 'resposta_grande', retryAfterMs: retryAfterEmMs(r.headers.get('retry-after'), Date.now()) }
            : { tipo: 'recusa', status: r.status, codigo: 'resposta_grande' };
        }
        const corpo = jsonOuNulo(texto);
        if (r.status >= 200 && r.status < 300) {
          return { tipo: 'ok', status: r.status, corpo, replay: r.headers.get('idempotent-replay')?.trim().toLowerCase() === 'true' };
        }
        if (retentavel) {
          return { tipo: 'retentavel', status: r.status, codigo: codigoDoCorpo(corpo), retryAfterMs: retryAfterEmMs(r.headers.get('retry-after'), Date.now()) };
        }
        return { tipo: 'recusa', status: r.status, codigo: codigoDoCorpo(corpo) };
      } catch {
        // a mensagem do erro do fetch nunca sai daqui (pode citar URL ou cabeçalho)
        return { tipo: 'retentavel', status: null, codigo: estourou ? 'timeout' : 'rede', retryAfterMs: null };
      } finally {
        clearTimeout(relogio);
      }
    },
  });
}
