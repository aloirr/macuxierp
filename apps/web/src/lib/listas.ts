/**
 * Chamada à API das telas de lista do BKO (servidor). A parte pura (filtros e URLs) está em `listas-url.ts`.
 * Paginação por cursor, filtros e CSV vêm do SDK (`@macuxierp/platform-sdk/listas`). Sem dado pessoal em log ou mensagem de erro.
 */
import type { z } from 'zod';
import { paginaDe, type Pagina } from '@macuxierp/platform-sdk/listas';
import { getValidado, usaApiFalsaAgora } from './api';
import { urlDaLista, type Filtros } from './listas-url';

const CAMINHO_API = /^\/v1\/[a-z0-9/_-]+$/;

/**
 * GET paginado na API, validado por `paginaDe(item)`. 401 vira NaoAutenticado, 403 vira SemPermissao e 400 vira
 * DadosInvalidos (a tela volta a `urlInicio`, sem cursor e sem limite); o resto (5xx, rede, fora do contrato) vira ApiIndisponivel.
 * Sem MACUXIERP_API_URL fora de produção (modo falso), devolve a página vazia.
 * `caminhoApi` é constante do código da tela (`/v1/...`); fora do padrão lança Error de programação.
 */
export async function buscarPagina<T extends z.ZodTypeAny>(
  caminhoApi: string,
  filtros: Filtros,
  item: T,
  acesso: string,
): Promise<Pagina<z.infer<T>>> {
  if (!CAMINHO_API.test(caminhoApi)) throw new Error('buscarPagina: caminho da API inválido');
  const schema = paginaDe(item);
  if (usaApiFalsaAgora()) return schema.parse({ itens: [], proximo_cursor: null }) as Pagina<z.infer<T>>;
  return getValidado(urlDaLista(caminhoApi, filtros), schema, acesso, 'lista', true) as Promise<Pagina<z.infer<T>>>;
}
