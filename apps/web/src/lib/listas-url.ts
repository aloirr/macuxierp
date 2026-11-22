/**
 * Parte pura (sem I/O, segura para 'use client') das telas de lista do BKO: filtros e URLs
 * (contrato `.coord/contratos/listas.md`; RD-0002 e RD-0003). Sem dado pessoal em log ou mensagem de erro.
 */
import { lerFiltros, paraQuery } from '@macuxierp/platform-sdk/listas';

export type Filtros = Readonly<Record<string, string>>;

/** Só as chaves de paginação são comuns; `busca` e `inativos` entram apenas se a página as declarar (a auditoria do core não aceita busca). */
const CHAVES_COMUNS = ['cursor', 'limite'] as const;

/**
 * Filtros da tela a partir da URL: as chaves declaradas pela página mais `cursor` e `limite` (sem repetir chave; a primeira ocorrência vence).
 * `inativos` só entra com o valor exato 'true' (ausência = false, contrato ConsultaLista); qualquer outro valor é descartado.
 */
export function consultaDaTela(search: string | URLSearchParams, filtrosDaPagina: readonly string[]): Record<string, string> {
  const f = lerFiltros(search, [...new Set([...filtrosDaPagina, ...CHAVES_COMUNS])]);
  if (f.inativos !== undefined && f.inativos !== 'true') delete f.inativos;
  return f;
}

/** Mesma query para a URL da tela e para a API. */
export function urlDaLista(caminho: string, filtros: Filtros): string {
  return caminho + paraQuery(filtros);
}

function semCursor(f: Filtros): Record<string, string> {
  const { cursor: _cursor, ...resto } = f;
  return resto;
}

/** Aplica o filtro e volta à primeira página (remove `cursor`). Valor vazio remove a chave. */
export function trocarFiltro(filtros: Filtros, chave: string, valor: string | undefined): Record<string, string> {
  const novo = semCursor(filtros);
  if (chave === 'cursor') return novo;
  if (valor) novo[chave] = valor;
  else delete novo[chave];
  return novo;
}

/** Primeira página, mantendo os demais filtros. */
export function urlInicio(caminho: string, filtros: Filtros): string {
  return urlDaLista(caminho, semCursor(filtros));
}

/** Próxima página; null na última (`proximo_cursor` nulo). */
export function urlProxima(caminho: string, filtros: Filtros, proximoCursor: string | null): string | null {
  return proximoCursor === null ? null : urlDaLista(caminho, { ...filtros, cursor: proximoCursor });
}
