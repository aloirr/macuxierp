/** Filtros e links da lista genérica (parte pura). */
import { filtrosDaUrl, proximaPagina, urlDaLista } from '@macuxierp/platform-sdk/listas';
import type { TelaLista } from './tipos';

/** Filtros da tela a partir da URL (só as chaves declaradas pelo descritor, mais busca e paginação). */
export function filtrosDaTela(tela: TelaLista, busca: URLSearchParams): Record<string, string> {
  return filtrosDaUrl(tela.pagina, busca);
}

export function hrefProxima(rota: string, filtros: Readonly<Record<string, string>>, proximoCursor: string | null): string | null {
  const f = proximaPagina(filtros, proximoCursor);
  return f ? urlDaLista(rota, f) : null;
}

/** Troca o valor da célula pelo rótulo da opção quando a coluna tem o mesmo id de um filtro de cadastro (filial, vendedor): o UUID não aparece na tela. */
export function rotuloDaCelula(texto: string, opcoes: ReadonlyMap<string, string> | undefined): string {
  return opcoes?.get(texto) ?? texto;
}
