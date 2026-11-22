/**
 * Listas do BKO num lugar só (RD-0002 e RD-0003; contrato em `.coord/contratos/listas.md`): paginação por cursor,
 * filtros na URL e CSV. Sem dependência de Node: o shell (`apps/web`) importa por `@macuxierp/platform-sdk/listas`.
 *
 * Paginação única (desenho T-0002, seção 2): `?limite=50` (1 a 200) e `?cursor=<id do último item>`, ordem estável por
 * `id`; a resposta é `{ itens, proximo_cursor }`, com `proximo_cursor` nulo na última página. Nada de `pagina`/`por_pagina`.
 */
import { z } from 'zod';
import type { CamposErro } from './erros';
import { formatarDataHora } from './formatar';
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
/** Constantes do CSV, as mesmas na escrita (`paraCsv`) e na leitura (`lerCsv`, D11 da T-0026). */
const BOM = String.fromCharCode(0xfeff);
const SEPARADOR_PADRAO = ';';
const ASPAS = '"';
const PRECISA_ASPAS = new RegExp(`[${SEPARADOR_PADRAO}${ASPAS}\\r\\n]`);
const FORMULA = /^[=+\-@\t\r]/;

function celula(v: ValorCsv): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Injeção de fórmula em planilha: texto que começa com = + - @ ganha apóstrofo; número negativo continua número.
  if (typeof v === 'string' && FORMULA.test(s)) s = `'${s}`;
  return PRECISA_ASPAS.test(s) ? `${ASPAS}${s.replaceAll(ASPAS, ASPAS + ASPAS)}${ASPAS}` : s;
}

export function paraCsv<L>(colunas: readonly ColunaCsv<L>[], linhas: readonly L[]): string {
  const cab = colunas.map((c) => celula(c.titulo)).join(SEPARADOR_PADRAO);
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(SEPARADOR_PADRAO));
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
  /** Texto do estado vazio (MC-0016): sem filtro (nada cadastrado) e com filtro (nada com estes filtros). Opcional. */
  vazio?: TextoVazioLista;
}

/** Texto do estado vazio da lista, sem e com filtro (R-20261122-040324, MC-0016). */
export interface TextoVazioLista {
  semFiltro: string;
  comFiltro: string;
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
  /** Texto do estado vazio, quando a definição declarou; ausente, a tela usa o texto padrão dela. */
  readonly vazio?: Readonly<TextoVazioLista>;
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
  const textoOk = (t: unknown) => typeof t === 'string' && t.trim() !== '';
  if (d.vazio !== undefined && !(textoOk(d.vazio.semFiltro) && textoOk(d.vazio.comFiltro))) falha('vazio.semFiltro e vazio.comFiltro devem ser texto não vazio');

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
    ...(d.vazio ? { vazio: Object.freeze({ semFiltro: d.vazio.semFiltro, comFiltro: d.vazio.comFiltro }) } : {}),
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

/** Instante ISO 8601 completo, com `Z` ou deslocamento (como sai do banco e do `toISOString`); data civil não entra. */
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * CSV da lista para a rota da API: colunas do perfil, `paraCsv` e `respostaCsv` com o nome do descritor.
 * `fuso` (IANA, `fusoDaRota(c)`; T-0042, regra 4): a célula que é um instante ISO completo (coluna de data e hora com
 * o valor cru da API) sai como `formatarDataHora(iso, fuso)` ("21/11/2026 22:00"); data civil, texto e valor já
 * formatado ficam como estão. Sem `fuso`, o CSV é o de antes (o ISO como veio).
 */
export function csvDaLista<L>(
  pagina: { id: string; colunas: readonly ColunaLista<L>[]; csv: { readonly arquivo: string } | false },
  perfil: Perfil,
  linhas: readonly L[],
  fuso?: string,
): RespostaRota {
  if (!pagina.csv) throw new PaginaListaInvalida(`página de lista "${pagina.id}": sem CSV declarado`);
  const colunas = colunasDoPerfil(pagina, perfil);
  const noFuso = fuso === undefined ? colunas : colunas.map((c) => ({ ...c, valor: (l: L) => instanteNoFuso(c.valor(l), fuso) }));
  return respostaCsv(pagina.csv.arquivo, paraCsv(noFuso, linhas));
}

function instanteNoFuso(v: ValorCsv, fuso: string): ValorCsv {
  return typeof v === 'string' && INSTANTE_ISO.test(v) ? formatarDataHora(v, fuso) : v;
}

// ---- Leitura de CSV (D11 da T-0026): só o genérico; layout, mapeamento e RN ficam no domain do módulo ----

export type SeparadorCsv = ';' | ',';

/**
 * Arquivo recusado por inteiro. `coluna` é o nome do cabeçalho só quando ele parece nome de coluna (`^[a-z][a-z0-9_.]{0,59}$`);
 * fora disso, só a posição ("coluna 3"): num CSV sem cabeçalho, a 1ª linha é dado (LGPD). Nunca o valor de uma célula.
 */
export interface ErroArquivoCsv {
  codigo: 'CSV_CODIFICACAO' | 'CSV_VAZIO' | 'CSV_ASPAS' | 'CSV_COLUNA_DESCONHECIDA' | 'CSV_COLUNA_REPETIDA' | 'CSV_COLUNA_AUSENTE';
  /** Linha física (1 = cabeçalho); `null` quando não se aplica. */
  linha: number | null;
  coluna: string | null;
  motivo: string;
}

/** Linha recusada pela leitura (as demais seguem). */
export interface ErroLinhaCsv {
  codigo: 'CSV_CELULAS_A_MAIS';
  linha: number;
  motivo: string;
}

/** Linha lida: `numero` é a linha física onde o registro começa (1 = cabeçalho); célula ausente ou vazia = `''`. */
export interface LinhaCsv {
  numero: number;
  celulas: Readonly<Record<string, string>>;
}

export interface CsvLido {
  separador: SeparadorCsv;
  /** Colunas do arquivo, em minúsculas, na ordem do cabeçalho. */
  colunas: readonly string[];
  linhas: readonly LinhaCsv[];
  errosLinha: readonly ErroLinhaCsv[];
}

export type ResultadoLeituraCsv = ({ ok: true } & CsvLido) | { ok: false; erro: ErroArquivoCsv };

export interface OpcoesLeituraCsv {
  /** Todas as colunas aceitas (minúsculas). Outra coluna recusa o arquivo. */
  aceitas: readonly string[];
  /** Colunas que precisam estar no cabeçalho (o conteúdo vazio é regra do domain). */
  obrigatorias?: readonly string[];
}

const MOTIVO_UTF8 = 'O arquivo não está em UTF-8: no Excel, use "Salvar como" > "CSV UTF-8"';
// Começa por letra: CPF ou CNPJ sem máscara (só dígitos) também cairia em `[a-z0-9_.]` e seria ecoado.
const NOME_COLUNA = /^[a-z][a-z0-9_.]{0,59}$/;
/** O nome do cabeçalho, se parece nome de coluna; senão a posição (1 = primeira), sem ecoar o texto. */
const nomeColuna = (s: string, indice: number) => (NOME_COLUNA.test(s) ? s : `coluna ${indice + 1}`);

function textoDoArquivo(entrada: Uint8Array | string): string | null {
  let texto: string;
  if (typeof entrada === 'string') texto = entrada;
  else {
    try {
      texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entrada);
    } catch {
      return null;
    }
  }
  return texto.startsWith(BOM) ? texto.slice(1) : texto;
}

/** Separador da 1ª linha: vence o mais frequente fora de aspas; empate dá `;`. */
export function detectarSeparador(primeiraLinha: string): SeparadorCsv {
  let pv = 0;
  let vi = 0;
  let dentro = false;
  for (const ch of primeiraLinha) {
    if (ch === ASPAS) dentro = !dentro;
    else if (!dentro && ch === ';') pv++;
    else if (!dentro && ch === ',') vi++;
  }
  return vi > pv ? ',' : ';';
}

interface RegistroBruto {
  numero: number;
  celulas: string[];
}

/** RFC 4180: aspas duplas, `""` dentro de aspas e quebra de linha dentro de aspas; CRLF, LF ou CR. */
function registros(texto: string, sep: SeparadorCsv): RegistroBruto[] | { aspasAbertasNaLinha: number } {
  const saida: RegistroBruto[] = [];
  let linhaFisica = 1;
  let inicio = 1;
  let celulas: string[] = [];
  let atual = '';
  let dentro = false;
  let houveConteudo = false;
  const fechar = () => {
    celulas.push(atual);
    saida.push({ numero: inicio, celulas });
    celulas = [];
    atual = '';
    houveConteudo = false;
  };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (dentro) {
      if (ch === ASPAS) {
        if (texto[i + 1] === ASPAS) {
          atual += ASPAS;
          i++;
        } else dentro = false;
      } else {
        if (ch === '\n' || (ch === '\r' && texto[i + 1] !== '\n')) linhaFisica++;
        atual += ch;
      }
      continue;
    }
    if (ch === ASPAS && atual.trim() === '') {
      dentro = true;
      atual = '';
      houveConteudo = true;
    } else if (ch === sep) {
      celulas.push(atual);
      atual = '';
      houveConteudo = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fechar();
      linhaFisica++;
      inicio = linhaFisica;
    } else {
      atual += ch;
      houveConteudo = true;
    }
  }
  if (dentro) return { aspasAbertasNaLinha: inicio };
  if (houveConteudo || atual !== '' || celulas.length) fechar();
  return saida;
}

/**
 * Lê um CSV (UTF-8 com ou sem BOM; separador `;` ou `,` pela 1ª linha; aspas da RFC 4180; células aparadas). O
 * cabeçalho é por nome, sem diferença de maiúsculas, em qualquer ordem. Coluna fora de `aceitas`, repetida ou
 * obrigatória ausente recusa o arquivo. Linha em branco (ou só com separadores) é ignorada e conta na numeração.
 * Linha com mais células preenchidas que o cabeçalho vai para `errosLinha`. Nenhum valor de célula vai para os erros.
 */
export function lerCsv(entrada: Uint8Array | string, opcoes: OpcoesLeituraCsv): ResultadoLeituraCsv {
  const falha = (codigo: ErroArquivoCsv['codigo'], motivo: string, linha: number | null = null, coluna: string | null = null): ResultadoLeituraCsv => ({
    ok: false,
    erro: { codigo, linha, coluna, motivo },
  });
  const texto = textoDoArquivo(entrada);
  if (texto === null) return falha('CSV_CODIFICACAO', MOTIVO_UTF8);
  const separador = detectarSeparador(texto.slice(0, texto.search(/\r|\n|$/)));
  const brutos = registros(texto, separador);
  if (!Array.isArray(brutos)) return falha('CSV_ASPAS', 'Aspas abertas e não fechadas', brutos.aspasAbertasNaLinha);
  const vazia = (r: RegistroBruto) => r.celulas.every((c) => c.trim() === '');
  const cab = brutos.find((r) => !vazia(r));
  if (!cab) return falha('CSV_VAZIO', 'Arquivo vazio: falta o cabeçalho');
  const colunas = cab.celulas.map((c) => c.trim().toLowerCase());
  while (colunas.length && colunas.at(-1) === '') colunas.pop(); // `;` sobrando no fim do cabeçalho (Excel)
  const aceitas = new Set(opcoes.aceitas.map((c) => c.toLowerCase()));
  const vistas = new Set<string>();
  for (const [i, c] of colunas.entries()) {
    if (!aceitas.has(c)) return falha('CSV_COLUNA_DESCONHECIDA', c ? 'Coluna desconhecida no cabeçalho' : 'Coluna sem nome no cabeçalho', cab.numero, nomeColuna(c, i));
    if (vistas.has(c)) return falha('CSV_COLUNA_REPETIDA', 'Coluna repetida no cabeçalho', cab.numero, nomeColuna(c, i));
    vistas.add(c);
  }
  for (const c of opcoes.obrigatorias ?? []) {
    // O nome vem do layout do módulo (não do arquivo); a posição não se aplica.
    if (!vistas.has(c.toLowerCase())) return falha('CSV_COLUNA_AUSENTE', 'Coluna obrigatória ausente no cabeçalho', cab.numero, nomeColuna(c.toLowerCase(), -1));
  }
  const linhas: LinhaCsv[] = [];
  const errosLinha: ErroLinhaCsv[] = [];
  for (const r of brutos) {
    if (r.numero <= cab.numero || vazia(r)) continue;
    if (r.celulas.slice(colunas.length).some((c) => c.trim() !== '')) {
      errosLinha.push({ codigo: 'CSV_CELULAS_A_MAIS', linha: r.numero, motivo: `Linha com mais células que as ${colunas.length} colunas do cabeçalho` });
      continue;
    }
    const celulas: Record<string, string> = {};
    colunas.forEach((c, i) => (celulas[c] = (r.celulas[i] ?? '').trim()));
    linhas.push({ numero: r.numero, celulas });
  }
  return { ok: true, separador, colunas, linhas, errosLinha };
}

// ---- Conversores de célula: célula vazia = `undefined` (não altera nada); o motivo nunca repete o valor ----

export type CelulaConvertida<T> = { ok: true; valor: T | undefined } | { ok: false; motivo: string };

const vazio = <T>(): CelulaConvertida<T> => ({ ok: true, valor: undefined });
const ok = <T>(valor: T): CelulaConvertida<T> => ({ ok: true, valor });
const recusa = <T>(motivo: string): CelulaConvertida<T> => ({ ok: false, motivo });

const SIM = new Set(['sim', 's', 'true', '1', 'verdadeiro']);
const NAO = new Set(['não', 'nao', 'n', 'false', '0', 'falso']);

/** sim/não: `sim s true 1 verdadeiro` / `não nao n false 0 falso`, sem diferença de maiúsculas. */
export function celulaBooleana(celula: string): CelulaConvertida<boolean> {
  const s = celula.trim().toLowerCase();
  if (!s) return vazio();
  if (SIM.has(s)) return ok(true);
  if (NAO.has(s)) return ok(false);
  return recusa('Use sim ou não');
}

function dataValida(a: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Data `AAAA-MM-DD`, conferida no calendário; devolve a mesma `AAAA-MM-DD`. */
export function celulaData(celula: string): CelulaConvertida<string> {
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return recusa('Data no formato AAAA-MM-DD');
  if (!dataValida(Number(m[1]), Number(m[2]), Number(m[3]))) return recusa('Data inexistente');
  return ok(s);
}

/** Data-hora em UTC: `AAAA-MM-DDTHH:MM:SS[.mmm]Z`. Devolve o ISO normalizado (`toISOString`). */
export function celulaDataHora(celula: string): CelulaConvertida<string> {
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/.exec(s);
  if (!m) return recusa('Data-hora em UTC no formato AAAA-MM-DDTHH:MM:SSZ');
  if (!dataValida(Number(m[1]), Number(m[2]), Number(m[3])) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return recusa('Data-hora inexistente');
  return ok(new Date(s).toISOString());
}

/** Inteiro (sem casas nem milhar), com faixa opcional. */
export function celulaInteiro(celula: string, faixa: { min?: number; max?: number } = {}): CelulaConvertida<number> {
  const s = celula.trim();
  if (!s) return vazio();
  if (!/^-?\d+$/.test(s)) return recusa('Número inteiro, sem casas nem separador de milhar');
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return recusa('Número fora da faixa');
  if ((faixa.min !== undefined && n < faixa.min) || (faixa.max !== undefined && n > faixa.max)) {
    return recusa(`Número fora da faixa ${faixa.min ?? '...'} a ${faixa.max ?? '...'}`);
  }
  return ok(n);
}

/** Centavos (`*_cents`): inteiro ≥ 0. */
export function celulaCentavos(celula: string): CelulaConvertida<number> {
  const s = celula.trim();
  if (!s) return vazio();
  if (!/^\d+$/.test(s)) return recusa('Valor em centavos: inteiro sem casas, sem sinal e sem separador');
  const n = Number(s);
  return Number.isSafeInteger(n) ? ok(n) : recusa('Valor fora da faixa');
}

/**
 * Decimal com vírgula ou ponto, sem separador de milhar, devolvido como inteiro na escala de `casas`
 * (`celulaDecimal('12,5', 2)` → 1250; Qtd4: `celulaDecimal('1.25', 4)` → 12500). Sem arredondar: mais casas que o
 * permitido é recusado (zeros à direita são aceitos). `1.500` e `1,500` são ambíguos (milhar ou decimal?) e recusados.
 */
export function celulaDecimal(celula: string, casas: number, opcoes: { negativo?: boolean } = {}): CelulaConvertida<number> {
  if (!Number.isInteger(casas) || casas < 0 || casas > 6) throw new RangeError('celulaDecimal: casas de 0 a 6');
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return recusa('Número com vírgula ou ponto decimal, sem separador de milhar');
  const [, sinal, inteira, fracao = ''] = m;
  if (/^[1-9]\d{0,2}$/.test(inteira!) && fracao.length === 3) return recusa('Número ambíguo (milhar ou decimal?): escreva sem separador de milhar, ex.: 1500 ou 1,5');
  if (sinal && !opcoes.negativo) return recusa('Número negativo não é aceito');
  const significativa = fracao.replace(/0+$/, '');
  if (significativa.length > casas) return recusa(`No máximo ${casas} casas decimais`);
  const n = Number(`${inteira}${significativa.padEnd(casas, '0')}`);
  if (!Number.isSafeInteger(n)) return recusa('Número fora da faixa');
  return ok(sinal && n !== 0 ? -n : n);
}

/** Lista separada por `/` (ex.: `0/30/60`), itens aparados; item vazio recusa a célula. */
export function celulaLista(celula: string): CelulaConvertida<string[]> {
  const s = celula.trim();
  if (!s) return vazio();
  const itens = s.split('/').map((i) => i.trim());
  return itens.some((i) => !i) ? recusa('Lista separada por / com item vazio') : ok(itens);
}
