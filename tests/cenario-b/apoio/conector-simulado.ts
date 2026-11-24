/**
 * T-0057 (cenário B, ADR 0014 §2, §3, §6 e §13): Conector simulado. É o mínimo do Conector do FDV 1.5.0 que o arnês
 * precisa para falar com a `/entrada/v1` do ERP: monta o envelope do Hub v1 (`CorpoLote`), divide a carga completa em
 * partes da mesma sessão, manda `Authorization: Bearer`, `X-Macuxi-Conector-Id` e `Idempotency-Key` (sem versão no
 * cabeçalho: a versão do Conector vai no `CorpoSinal.versao_conector`, P-3), guarda o lote na fila local antes de enviar (o reenvio manda os mesmos bytes com a mesma chave) e
 * busca o que desce (pedido, nota e pré-cadastro) para o `lado-cliente.ts`.
 *
 * Não é o `apps/conector` (ele ainda não existe no main): serve para os cenários E2 a E4 rodarem antes e depois dele com
 * o mesmo arnês. Quando o `apps/conector` entrar, os cenários ganham um segundo adaptador que roda o Conector de verdade.
 *
 * Tipos locais mínimos. TODO(T-0057): trocar pelos de `@macuxierp/platform-sdk/hub-v1` (`CorpoLote`, `LoteAceito`,
 * `LoteResultado`, `CursorEntidade`, `CorpoSinal`, `RespostaSinal`) quando o PR do engenheiro entrar no main. Até lá o
 * envelope é conferido, nos testes, contra o Zod do `modules/integracao-fdv/contracts/hub.ts` do main, que a ADR 0014 §2
 * trava igual ao do SDK (o arnês não escreve uma terceira cópia do Zod).
 *
 * Segredo: a chave fica só no fecho; `toJSON`/`inspect` e as mensagens de erro nunca levam a chave nem o corpo (§3, LGPD).
 */
import { createHash, randomUUID } from 'node:crypto';
import { emFatias } from '../../ponta-a-ponta-fdv/apoio/contrato-hub';

/**
 * Caminhos da `/entrada/v1`, fonte única do arnês. TODO(T-0057, regra T-0066): trocar pela constante `CAMINHOS_*` da
 * `/entrada/v1` no SDK quando ela existir; o teste de contrato lê do SDK, nunca desta lista.
 */
export const CAMINHOS_ENTRADA_V1 = Object.freeze({
  prefixo: '/entrada/v1',
  lotes: '/lotes',
  lote: '/lotes/:id',
  cursor: '/cursores/:entidade',
  sinal: '/sinal',
  pedidosPendentes: '/pedidos/pendentes',
  pedidoRetorno: '/pedidos/:uuid/retorno',
  notasPendentes: '/notas/pendentes',
  notaRetorno: '/notas/:chave/retorno',
  clientesPendentes: '/clientes/pendentes',
  clienteRetorno: '/clientes/:uuid/retorno',
});

/** Troca os `:param` do caminho (valor codificado; nunca concatena texto cru na URL). */
export function caminho(modelo: string, params: Record<string, string> = {}): string {
  return modelo.replace(/:([a-z]+)/g, (_, nome: string) => {
    const v = params[nome];
    if (v === undefined) throw new Error(`caminho: falta o parâmetro ${nome}.`);
    return encodeURIComponent(v);
  });
}

/** As 10 entidades da F2, na ordem de carga (RN-INF-02; `ENTIDADES_ENVIO_FDV` do SDK). TODO(T-0057): ler do SDK. */
export const ENTIDADES_F2 = [
  'filial',
  'vendedor',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
  'cliente_endereco',
] as const;
export type EntidadeF2 = (typeof ENTIDADES_F2)[number];

/** `LIMITE_REGISTROS_LOTE` do hub-v1 (5.000). */
export const LIMITE_REGISTROS_LOTE = 5000;
export const VERSAO_CONTRATO = 'v1' as const;
/**
 * Versão que o Conector do ERP declara (cópia do 1.5.0 do FDV, ADR 0014 §6). P-3 (respondida): não vai em cabeçalho; vai
 * só no `CorpoSinal.versao_conector`. O lote leva `versao_contrato: 'v1'` no corpo.
 */
export const VERSAO_CONECTOR = '1.0.0';
export const FORMATO_CONECTOR_ID = /^[A-Za-z0-9._-]{1,100}$/;
/** P-1 (respondida): o `conector_id` vai só neste cabeçalho. TODO(T-0057): `CABECALHO_CONECTOR_ID` do SDK no -3. */
export const CABECALHO_CONECTOR_ID = 'x-macuxi-conector-id';
/** P-4 (respondida): a `Idempotency-Key` é obrigatória e segue este padrão. */
export const FORMATO_IDEMPOTENCIA = /^[A-Za-z0-9_.:-]{8,128}$/;
/** P-11 (respondida): teto provisório do corpo do lote. TODO(T-0057): `MAX_BYTES_LOTE_ENTRADA` do SDK no -3. */
export const MAX_BYTES_LOTE_ENTRADA = 8 * 1024 * 1024;

export type ModoLote = 'completo' | 'delta';
export interface CursorLocal {
  alterado_em: string;
  external_id: string;
}
export interface SessaoLocal {
  id: string;
  parte: number;
  ultimo: boolean;
}
/** Registro como vai no lote: o payload da entidade + `alterado_em` (UTC com `Z`). */
export interface RegistroLocal {
  external_id: string;
  alterado_em: string;
  ativo: boolean;
  [campo: string]: unknown;
}
export interface LinhaInvalidaLocal {
  external_id: string;
  codigo: 'campo_obrigatorio' | 'formato_invalido' | 'regra_invalida';
  campo?: string | null;
  mensagem: string;
}
/** Espelho mínimo de `CorpoLote` do hub-v1 (TODO: SDK). */
export interface EnvelopeLocal {
  versao_contrato: typeof VERSAO_CONTRATO;
  entidade: string;
  modo: ModoLote;
  enviado_em: string;
  cursor: CursorLocal | null;
  sessao?: SessaoLocal;
  registros: RegistroLocal[];
  linhas_invalidas: LinhaInvalidaLocal[];
  linhas_invalidas_omitidas: number;
}

/** Lote na fila local do Conector: a chave e os bytes ficam fixos desde a montagem (o reenvio não muda nada). */
export interface LoteNaFila {
  readonly chave: string;
  readonly entidade: string;
  readonly corpo: string;
  readonly envelope: EnvelopeLocal;
}

export interface RespostaHttp {
  status: number;
  corpo: unknown;
  /** Cabeçalhos em minúsculas. */
  cabecalhos: Record<string, string>;
}

export interface RequisicaoFeita {
  metodo: string;
  caminho: string;
  status: number;
  chaveIdempotencia: string | null;
}

export interface OpcoesConectorSimulado {
  /** Base do ERP sem a `/entrada/v1` (ex.: `https://erp.exemplo`); http só em localhost (§6.1). */
  url: string;
  conectorId: string;
  /** A chave do conector (mostrada uma vez no `/config`). Nunca sai deste fecho. */
  chave: string;
  /** Relógio do teste (UTC). */
  agora: () => Date;
  /** `fetch` injetável (padrão: o global). */
  fetch?: typeof fetch;
  /** Troca o prefixo (§6.1: `hub.prefixo`); padrão `/entrada/v1`. */
  prefixo?: string;
  /** Registros por lote (padrão 5.000; o teste pede menos para forçar várias partes). */
  limiteLote?: number;
  versaoConector?: string;
  /** Gera o id da sessão de carga completa (padrão UUID v4). */
  novoId?: () => string;
}

export class ErroConectorSimulado extends Error {
  override readonly name = 'ErroConectorSimulado';
}

/** JSON canônico (chaves ordenadas): o mesmo envelope dá sempre os mesmos bytes e a mesma chave. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}

/** `Idempotency-Key` do lote: entidade + SHA-256 do corpo canônico (40 hex). Mesmo corpo = mesma chave. */
export function chaveIdempotencia(entidade: string, corpo: string): string {
  return `cb:${entidade}:${createHash('sha256').update(corpo).digest('hex').slice(0, 40)}`;
}

function validarUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErroConectorSimulado('conector simulado: URL inválida.');
  }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
    throw new ErroConectorSimulado('conector simulado: só HTTPS (HTTP só em localhost, ADR 0014 §6.1).');
  return u;
}

/** Fatias do lote (a do arnês, RD-1440); a carga completa vazia ainda manda uma parte (o último da sessão). */
const fatiasDoLote = <T>(lista: readonly T[], n: number): T[][] => {
  const fatias = emFatias(lista, n);
  return fatias.length ? fatias : [[]];
};

export interface ConectorSimulado {
  readonly conectorId: string;
  /** Monta e guarda na fila (sem enviar) a carga completa: várias partes da mesma sessão, a última com `ultimo: true`. */
  montarCargaCompleta(
    entidade: string,
    registros: readonly RegistroLocal[],
    invalidas?: readonly LinhaInvalidaLocal[],
  ): LoteNaFila[];
  /** Monta e guarda na fila um delta a partir do cursor (sem sessão). */
  montarDelta(
    entidade: string,
    registros: readonly RegistroLocal[],
    cursor: CursorLocal | null,
  ): LoteNaFila[];
  /** `POST /lotes` com os bytes e a chave do lote da fila. */
  enviar(lote: LoteNaFila): Promise<RespostaHttp>;
  /** Mesma chave, outro corpo (para provar o 409 da §3). */
  enviarComChave(chave: string, envelope: EnvelopeLocal): Promise<RespostaHttp>;
  consultarLote(loteId: string, limiteErros?: number): Promise<RespostaHttp>;
  consultarCursor(entidade: string): Promise<RespostaHttp>;
  enviarSinal(corpo: Record<string, unknown>): Promise<RespostaHttp>;
  /** Corpo do sinal no molde do `CorpoSinal` do hub-v1, com a `versao_conector` (P-3). */
  montarSinal(entidades?: readonly string[]): Record<string, unknown>;
  /** Descida (§13): `GET /<recurso>/pendentes`. */
  pendentes(recurso: 'pedidos' | 'notas' | 'clientes'): Promise<RespostaHttp>;
  /** Descida (§13): `POST /<recurso>/:id/retorno`. */
  retorno(
    recurso: 'pedidos' | 'notas' | 'clientes',
    id: string,
    corpo: Record<string, unknown>,
  ): Promise<RespostaHttp>;
  /** Requisição livre (com as credenciais deste conector), para os casos de recusa. */
  requisitar(
    metodo: string,
    caminhoRelativo: string,
    corpo?: string,
    extras?: Record<string, string>,
  ): Promise<RespostaHttp>;
  readonly fila: readonly LoteNaFila[];
  /** Método, caminho, status e chave de idempotência; nunca corpo nem `Authorization`. */
  readonly requisicoes: readonly RequisicaoFeita[];
  toJSON(): Record<string, unknown>;
}

export function criarConectorSimulado(o: OpcoesConectorSimulado): ConectorSimulado {
  const base = validarUrl(o.url);
  if (!FORMATO_CONECTOR_ID.test(o.conectorId))
    throw new ErroConectorSimulado('conector simulado: conector_id fora de [A-Za-z0-9._-]{1,100}.');
  if (!o.chave) throw new ErroConectorSimulado('conector simulado: sem chave.');
  const chave = o.chave;
  const prefixo = o.prefixo ?? CAMINHOS_ENTRADA_V1.prefixo;
  const limite = o.limiteLote ?? LIMITE_REGISTROS_LOTE;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_REGISTROS_LOTE)
    throw new ErroConectorSimulado('conector simulado: limiteLote entre 1 e 5.000.');
  const f = o.fetch ?? globalThis.fetch;
  const novoId = o.novoId ?? randomUUID;
  const versao = o.versaoConector ?? VERSAO_CONECTOR;
  const fila: LoteNaFila[] = [];
  const requisicoes: RequisicaoFeita[] = [];

  function guardar(envelope: EnvelopeLocal): LoteNaFila {
    const corpo = jsonCanonico(envelope);
    const lote = Object.freeze({
      chave: chaveIdempotencia(envelope.entidade, corpo),
      entidade: envelope.entidade,
      corpo,
      envelope,
    });
    fila.push(lote);
    return lote;
  }

  async function requisitar(
    metodo: string,
    rel: string,
    corpo?: string,
    extras: Record<string, string> = {},
  ): Promise<RespostaHttp> {
    const cab: Record<string, string> = {
      authorization: `Bearer ${chave}`,
      [CABECALHO_CONECTOR_ID]: o.conectorId,
      accept: 'application/json',
      ...Object.fromEntries(Object.entries(extras).map(([k, v]) => [k.toLowerCase(), v])),
    };
    if (corpo !== undefined) cab['content-type'] = 'application/json';
    const alvo = new URL(base.pathname.replace(/\/$/, '') + prefixo + rel, base);
    const r = await f(alvo, { method: metodo, headers: cab, body: corpo });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = texto ? (JSON.parse(texto) as unknown) : null;
    } catch {
      json = null;
    }
    const cabecalhos: Record<string, string> = {};
    r.headers.forEach((v, k) => (cabecalhos[k.toLowerCase()] = v));
    requisicoes.push({
      metodo,
      caminho: prefixo + rel,
      status: r.status,
      chaveIdempotencia: cab['idempotency-key'] ?? null,
    });
    return { status: r.status, corpo: json, cabecalhos };
  }

  const envelopeBase = (
    entidade: string,
    modo: ModoLote,
    cursor: CursorLocal | null,
  ): Omit<EnvelopeLocal, 'registros' | 'linhas_invalidas' | 'linhas_invalidas_omitidas'> => ({
    versao_contrato: VERSAO_CONTRATO,
    entidade,
    modo,
    enviado_em: o.agora().toISOString(),
    cursor,
  });

  const conector: ConectorSimulado = {
    conectorId: o.conectorId,
    montarCargaCompleta(entidade, registros, invalidas = []) {
      const sessao = novoId();
      const partes = fatiasDoLote(registros, limite);
      return partes.map((regs, i) =>
        guardar({
          ...envelopeBase(entidade, 'completo', null),
          sessao: { id: sessao, parte: i + 1, ultimo: i === partes.length - 1 },
          registros: regs.map((r) => ({ ...r })),
          // as linhas inválidas vão na primeira parte (o Conector as acha ao ler a view)
          linhas_invalidas: i === 0 ? invalidas.map((l) => ({ ...l })) : [],
          linhas_invalidas_omitidas: 0,
        }),
      );
    },
    montarDelta(entidade, registros, cursor) {
      return fatiasDoLote(registros, limite).map((regs) =>
        guardar({
          ...envelopeBase(entidade, 'delta', cursor),
          registros: regs.map((r) => ({ ...r })),
          linhas_invalidas: [],
          linhas_invalidas_omitidas: 0,
        }),
      );
    },
    enviar: (lote) =>
      requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, lote.corpo, { 'Idempotency-Key': lote.chave }),
    enviarComChave: (chaveIdem, envelope) =>
      requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, jsonCanonico(envelope), { 'Idempotency-Key': chaveIdem }),
    consultarLote: (id, limiteErros) =>
      requisitar(
        'GET',
        caminho(CAMINHOS_ENTRADA_V1.lote, { id }) +
          (limiteErros === undefined ? '' : `?limite_erros=${limiteErros}`),
      ),
    consultarCursor: (entidade) => requisitar('GET', caminho(CAMINHOS_ENTRADA_V1.cursor, { entidade })),
    enviarSinal: (corpo) => requisitar('POST', CAMINHOS_ENTRADA_V1.sinal, JSON.stringify(corpo)),
    montarSinal: (entidades = ENTIDADES_F2) => ({
      versao_contrato: VERSAO_CONTRATO,
      conector_id: o.conectorId,
      versao_conector: versao,
      em: o.agora().toISOString(),
      fila: [],
      entidades: entidades.map((entidade) => ({
        entidade,
        fase: 'delta',
        ultimo_sucesso: null,
        bloqueada: false,
        lotes_na_fila: fila.filter((l) => l.entidade === entidade).length,
      })),
    }),
    pendentes: (recurso) =>
      requisitar(
        'GET',
        recurso === 'pedidos'
          ? CAMINHOS_ENTRADA_V1.pedidosPendentes
          : recurso === 'notas'
            ? CAMINHOS_ENTRADA_V1.notasPendentes
            : CAMINHOS_ENTRADA_V1.clientesPendentes,
      ),
    retorno(recurso, id, corpo) {
      const modelo =
        recurso === 'pedidos'
          ? CAMINHOS_ENTRADA_V1.pedidoRetorno
          : recurso === 'notas'
            ? CAMINHOS_ENTRADA_V1.notaRetorno
            : CAMINHOS_ENTRADA_V1.clienteRetorno;
      const param: Record<string, string> = recurso === 'notas' ? { chave: id } : { uuid: id };
      return requisitar('POST', caminho(modelo, param), JSON.stringify(corpo));
    },
    requisitar,
    get fila() {
      return fila;
    },
    get requisicoes() {
      return requisicoes;
    },
    toJSON: () => ({ conectorId: o.conectorId, url: base.origin, prefixo, lotesNaFila: fila.length }),
  };
  Object.defineProperty(conector, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => conector.toJSON(),
  });
  return conector;
}
