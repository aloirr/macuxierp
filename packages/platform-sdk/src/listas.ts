/**
 * Listas do BKO num lugar só (RD-0002 e RD-0003; contrato em `.coord/contratos/listas.md`): paginação por cursor,
 * filtros na URL e CSV. Sem dependência de Node: o shell (`apps/web`) importa por `@macuxierp/platform-sdk/listas`.
 *
 * Paginação única (desenho T-0002, seção 2): `?limite=50` (1 a 200) e `?cursor=<id do último item>`, ordem estável por
 * `id`; a resposta é `{ itens, proximo_cursor }`, com `proximo_cursor` nulo na última página. Nada de `pagina`/`por_pagina`.
 */
import { z } from 'zod';
import type { RespostaRota } from './rotas';

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

export const ConsultaPaginada = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
  cursor: z.string().uuid().optional(),
});
export type ConsultaPaginada = z.infer<typeof ConsultaPaginada>;

/** Consulta das listas de cadastro: paginação, `?busca=` e `?inativos=true`. O módulo estende com os filtros dele. */
export const ConsultaLista = ConsultaPaginada.extend({
  busca: z.string().trim().max(80).optional(),
  inativos: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
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
