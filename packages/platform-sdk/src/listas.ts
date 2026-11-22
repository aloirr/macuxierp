/**
 * Listas do BKO num lugar só (RD-0002 e RD-0003; contrato em `.coord/contratos/listas.md`): paginação por cursor,
 * filtros na URL e CSV. Sem dependência de Node: o shell (`apps/web`) importa por `@macuxierp/platform-sdk/listas`.
 *
 * Paginação única (desenho T-0002, seção 2): `?limite=50` (1 a 200) e `?cursor=<id do último item>`, ordem estável por
 * `id`; a resposta é `{ itens, proximo_cursor }`, com `proximo_cursor` nulo na última página. Nada de `pagina`/`por_pagina`.
 */
import { z } from 'zod';
import type { CamposErro } from './erros';
import type { Perfil } from './modulo';
import { pode, type Acao } from './permissoes';
import type { RespostaRota } from './rotas';

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

/** Chaves de paginação, num lugar só (RD-0121): o shell, os módulos e a API usam estas constantes. */
export const CHAVE_CURSOR = 'cursor';
export const CHAVE_LIMITE = 'limite';
export const CHAVES_PAGINACAO = Object.freeze([CHAVE_CURSOR, CHAVE_LIMITE] as const);
/** Chaves comuns opcionais das listas: a página declara se aceita (`busca: true`, `inativos: true`). */
export const CHAVE_BUSCA = 'busca';
export const CHAVE_INATIVOS = 'inativos';
const BUSCA_MAXIMO = 80;
/** Fora do contrato (RD-0003): não existem nas listas e não viram filtro de módulo. */
export const CHAVES_FORA_DO_CONTRATO = Object.freeze(['pagina', 'por_pagina', 'total', 'offset'] as const);

export const ConsultaPaginada = z.object({
  [CHAVE_LIMITE]: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
  [CHAVE_CURSOR]: z.string().uuid().optional(),
});
export type ConsultaPaginada = z.infer<typeof ConsultaPaginada>;

const Busca = z.string().trim().max(BUSCA_MAXIMO).optional();
/** `?inativos=true` liga; ausente ou `false` desliga; outro valor é 400 VALIDACAO. O shell só escreve `true`. */
const Inativos = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Consulta das listas de cadastro: paginação, `?busca=` e `?inativos=true`. O módulo estende com os filtros dele. */
export const ConsultaLista = ConsultaPaginada.extend({ [CHAVE_BUSCA]: Busca, [CHAVE_INATIVOS]: Inativos });
export type ConsultaLista = z.infer<typeof ConsultaLista>;

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

/** Schema da resposta paginada de um item (`paginaDe(Cliente)`). */
export function paginaDe<T extends z.ZodTypeAny>(item: T) {
  return z.object({ itens: z.array(item), proximo_cursor: z.string().uuid().nullable() });
}

/**
 * O repositório busca `limite + 1` linhas com `id > cursor ORDER BY id`; aqui corta no limite e, se sobrou linha,
 * o `proximo_cursor` é o `id` do último item devolvido.
 */
export function paginar<T extends { id: string }>(linhas: readonly T[], limite: number): Pagina<T> {
  const itens = linhas.slice(0, limite);
  return { itens, proximo_cursor: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
}

// ---- Filtros na URL: recarregar ou compartilhar o link mantém o filtro ----

/** Só as chaves permitidas da página, aparadas, sem vazio; chave repetida fica com a primeira. */
export function lerFiltros(busca: string | URLSearchParams, permitidos: readonly string[]): Record<string, string> {
  const p = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const saida: Record<string, string> = {};
  for (const k of permitidos) {
    const v = p.get(k)?.trim();
    if (v) saida[k] = v;
  }
  return saida;
}

/** Query string estável (chaves em ordem, sem vazio), igual para a rota do shell e para a API. */
export function paraQuery(filtros: Readonly<Record<string, string | number | boolean | undefined | null>>): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(filtros).sort()) {
    const v = filtros[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- CSV no padrão do Excel em pt-BR: separador `;`, BOM UTF-8 e CRLF ----

export type ValorCsv = string | number | boolean | null | undefined;

export interface ColunaCsv<L> {
  titulo: string;
  valor(linha: L): ValorCsv;
}

export const TIPO_CSV = 'text/csv; charset=utf-8';
const BOM = String.fromCharCode(0xfeff);
const FORMULA = /^[=+\-@\t\r]/;

function celula(v: ValorCsv): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Injeção de fórmula em planilha: texto que começa com = + - @ ganha apóstrofo; número negativo continua número.
  if (typeof v === 'string' && FORMULA.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function paraCsv<L>(colunas: readonly ColunaCsv<L>[], linhas: readonly L[]): string {
  const cab = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';'));
  return `${BOM}${[cab, ...corpo].join('\r\n')}\r\n`;
}

/** Resposta de rota com o CSV para baixar (`clientes.csv`). O nome fica só com letras, dígitos, `.`, `_` e `-`. */
export function respostaCsv(nomeArquivo: string, csv: string): RespostaRota {
  const nome = nomeArquivo.replace(/[^A-Za-z0-9._-]/g, '_') || 'dados.csv';
  return { corpo: csv, cabecalhos: { 'content-type': TIPO_CSV, 'content-disposition': `attachment; filename="${nome}"`, 'cache-control': 'no-store' } };
}

// ---- Descritor comum de página de lista (T-0041; lacuna c do PR #37 e RD-0121) ----

/** Coluna da tabela e do CSV. `exige`: só o perfil com a ação vê a coluna (esconde; quem protege é a API). */
export interface ColunaLista<L> extends ColunaCsv<L> {
  id: string;
  exige?: Acao;
}

/** Filtros do módulo além da paginação, de `busca` e de `inativos`: chave da URL → Zod do valor (opcional). */
export type FiltrosLista = Readonly<Record<string, z.ZodTypeAny>>;

/** O que o módulo escreve em `modules/<m>/web` (e a API reusa na rota da lista). */
export interface DefinicaoPaginaLista<I extends z.ZodTypeAny, F extends FiltrosLista = Record<never, never>> {
  /** Segmento da rota do shell (`/<modulo>/<id>`), em minúsculas com hífen. */
  id: string;
  /** Rota da lista na API: `/v1/<modulo>/<recurso>`, sem query e sem `:param`. */
  api: string;
  /** Zod de um item da resposta `{ itens, proximo_cursor }`. */
  item: I;
  /** Aceita `?busca=` (até 80 caracteres). Padrão `false`. */
  busca?: boolean;
  /** Aceita `?inativos=true`. Padrão `false`. */
  inativos?: boolean;
  filtros?: F;
  colunas: readonly ColunaLista<z.infer<I>>[];
  /** Exportação CSV: a rota de CSV do módulo usa `csvDaLista` com este nome de arquivo; `false` = a página não exporta. */
  csv: { arquivo: string } | false;
}

/** Consulta validada da lista (saída do Zod): paginação, busca/inativos quando declarados e os filtros do módulo. */
export type ConsultaDaLista<F extends FiltrosLista> = ConsultaPaginada & Partial<Pick<ConsultaLista, typeof CHAVE_BUSCA | typeof CHAVE_INATIVOS>> & { [K in keyof F]: z.infer<F[K]> };

/** Descritor pronto (congelado): o que a definição declarou mais o que deriva dela. */
export interface PaginaLista<I extends z.ZodTypeAny = z.ZodTypeAny, F extends FiltrosLista = FiltrosLista> {
  readonly id: string;
  readonly api: string;
  readonly item: I;
  readonly busca: boolean;
  readonly inativos: boolean;
  readonly filtros: F;
  readonly colunas: readonly ColunaLista<z.infer<I>>[];
  readonly csv: { readonly arquivo: string } | false;
  /** Chaves aceitas na URL da tela e na consulta da API, em ordem alfabética (filtros, busca, inativos e paginação). */
  readonly chaves: readonly string[];
  /** Zod da consulta da rota GET da lista (`definirRota({ consulta: pagina.consulta })`): inválido = 400 VALIDACAO. */
  readonly consulta: z.ZodType<ConsultaDaLista<F>, z.ZodTypeDef, unknown>;
  /** Zod da resposta: `paginaDe(item)`. */
  readonly resposta: ReturnType<typeof paginaDe<I>>;
}

export class PaginaListaInvalida extends Error {
  override readonly name = 'PaginaListaInvalida';
}

const ID_PAGINA = /^[a-z][a-z0-9-]{0,39}$/;
const API_LISTA = /^\/v1\/[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9_-]*)+$/;
const CHAVE_FILTRO = /^[a-z][a-z0-9_]{0,39}$/;
const ARQUIVO_CSV = /^[a-z0-9][a-z0-9_-]*\.csv$/;
/** Chaves que não viram filtro de módulo: paginação, `busca`, `inativos` e as fora do contrato. */
const RESERVADAS: ReadonlySet<string> = new Set([...CHAVES_PAGINACAO, CHAVE_BUSCA, CHAVE_INATIVOS, ...CHAVES_FORA_DO_CONTRATO]);

/**
 * Define a página de lista do módulo, validando o descritor na carga (erro de programação lança `PaginaListaInvalida`).
 * Ex.: `definirPaginaLista({ id: 'clientes', api: '/v1/cadastros/clientes', item: Cliente, busca: true, inativos: true,
 * filtros: { filial_id: z.string().uuid().optional() }, colunas: [...], csv: { arquivo: 'clientes.csv' } })`.
 */
export function definirPaginaLista<I extends z.ZodTypeAny, F extends FiltrosLista = Record<never, never>>(d: DefinicaoPaginaLista<I, F>): PaginaLista<I, F> {
  const falha = (msg: string): never => {
    throw new PaginaListaInvalida(`página de lista "${d.id}": ${msg}`);
  };
  if (!ID_PAGINA.test(d.id)) falha('id fora do padrão (minúsculas, dígitos e hífen)');
  if (!API_LISTA.test(d.api)) falha('api deve ser /v1/<modulo>/<recurso>, sem query e sem :param');
  const filtros = (d.filtros ?? {}) as F;
  for (const k of Object.keys(filtros)) {
    if (!CHAVE_FILTRO.test(k)) falha(`filtro "${k}" fora do padrão (snake_case)`);
    if (RESERVADAS.has(k)) falha(`filtro "${k}" é chave reservada do contrato de listas`);
  }
  const ids = new Set<string>();
  for (const c of d.colunas) {
    if (ids.has(c.id)) falha(`coluna "${c.id}" repetida`);
    ids.add(c.id);
  }
  if (d.csv && !ARQUIVO_CSV.test(d.csv.arquivo)) falha('csv.arquivo deve ser <nome>.csv em minúsculas');

  const busca = d.busca ?? false;
  const inativos = d.inativos ?? false;
  const consulta = ConsultaPaginada.extend({
    ...(busca ? { [CHAVE_BUSCA]: Busca } : {}),
    ...(inativos ? { [CHAVE_INATIVOS]: Inativos } : {}),
    ...filtros,
  }) as unknown as z.ZodType<ConsultaDaLista<F>, z.ZodTypeDef, unknown>;
  const chaves = [...Object.keys(filtros), ...CHAVES_PAGINACAO, ...(busca ? [CHAVE_BUSCA] : []), ...(inativos ? [CHAVE_INATIVOS] : [])].sort();

  return Object.freeze({
    id: d.id,
    api: d.api,
    item: d.item,
    busca,
    inativos,
    filtros: Object.freeze({ ...filtros }),
    colunas: Object.freeze([...d.colunas]),
    csv: d.csv ? Object.freeze({ arquivo: d.csv.arquivo }) : false,
    chaves: Object.freeze(chaves),
    consulta,
    resposta: paginaDe(d.item),
  });
}

// ---- Filtros da tela a partir do descritor (parte pura, segura para 'use client') ----

export type FiltrosTela = Readonly<Record<string, string>>;

/** `inativos` só aparece quando é `true` (decisão do gerente, 21/11/2026 22h08 de Manaus); vazio sai. */
function normalizar(f: FiltrosTela): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    const t = v.trim();
    if (!t || (k === CHAVE_INATIVOS && t !== 'true')) continue;
    saida[k] = t;
  }
  return saida;
}

function sem(f: FiltrosTela, chaves: Iterable<string>): Record<string, string> {
  const fora = new Set(chaves);
  return Object.fromEntries(Object.entries(f).filter(([k]) => !fora.has(k)));
}

/** Filtros da tela lidos da URL: só as `chaves` da página, aparadas, sem vazio; `inativos` só com `true`. */
export function filtrosDaUrl(pagina: Pick<PaginaLista, 'chaves'>, busca: string | URLSearchParams): Record<string, string> {
  return normalizar(lerFiltros(busca, pagina.chaves));
}

/** A mesma URL para a tela (`/cadastros/clientes`) e para a API (`pagina.api`), com `paraQuery` e sem `inativos` falso. */
export function urlDaLista(caminho: string, filtros: FiltrosTela): string {
  return caminho + paraQuery(normalizar(filtros));
}

/** Primeira página com os mesmos filtros (sem `cursor`; o `limite` escolhido fica). */
export function primeiraPagina(filtros: FiltrosTela): Record<string, string> {
  return sem(filtros, [CHAVE_CURSOR]);
}

/** Próxima página; `null` na última (`proximo_cursor` nulo). */
export function proximaPagina(filtros: FiltrosTela, proximoCursor: string | null): Record<string, string> | null {
  return proximoCursor === null ? null : { ...filtros, [CHAVE_CURSOR]: proximoCursor };
}

/** Troca um filtro e volta à primeira página. Valor vazio remove; `inativos` diferente de `true` remove; `cursor` não se troca aqui. */
export function trocarFiltro(filtros: FiltrosTela, chave: string, valor: string | undefined): Record<string, string> {
  const novo = primeiraPagina(filtros);
  delete novo[chave];
  return chave === CHAVE_CURSOR ? novo : normalizar({ ...novo, [chave]: valor ?? '' });
}

/**
 * Depois de um 400 VALIDACAO da lista: o shell recomeça na primeira página, sem `cursor` e sem `limite`, e tira os
 * campos que a API apontou (`campos` do erro), para não repetir o 400.
 */
export function recomecarLista(filtros: FiltrosTela, campos?: CamposErro): Record<string, string> {
  return sem(filtros, [...CHAVES_PAGINACAO, ...Object.keys(campos ?? {})]);
}

// ---- Colunas e CSV do descritor ----

/** Colunas que o perfil vê (tabela e CSV). Esconde; a API checa de novo. */
export function colunasDoPerfil<L>(pagina: { colunas: readonly ColunaLista<L>[] }, perfil: Perfil): ColunaLista<L>[] {
  return pagina.colunas.filter((c) => !c.exige || pode(perfil, c.exige));
}

/** CSV da lista para a rota da API: colunas do perfil, `paraCsv` e `respostaCsv` com o nome do descritor. */
export function csvDaLista<L>(pagina: { id: string; colunas: readonly ColunaLista<L>[]; csv: { readonly arquivo: string } | false }, perfil: Perfil, linhas: readonly L[]): RespostaRota {
  if (!pagina.csv) throw new PaginaListaInvalida(`página de lista "${pagina.id}": sem CSV declarado`);
  return respostaCsv(pagina.csv.arquivo, paraCsv(colunasDoPerfil(pagina, perfil), linhas));
}
