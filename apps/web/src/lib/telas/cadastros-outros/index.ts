/**
 * Cadastros fora do núcleo (T-0123): Estoque e Tabelas oficiais (lote A). Condições, Equipe e itens de preço entram no lote B.
 * Daqui saem as telas (por rota) e as páginas do menu; `lib/telas.ts` e `lib/paginas.ts` só somam estes mapas.
 */
import type { PaginaBase } from '@macuxierp/platform-sdk';
import type { TelaDescrita } from '../../descritor/tipos';
import { LISTA_ESTOQUE, ROTA_ESTOQUE } from './estoque';
import { TABELAS_OFICIAIS_TELA } from './oficiais';

export { LISTA_ESTOQUE, ROTA_ESTOQUE, paginaEstoque } from './estoque';
export { ROTA_OFICIAIS, ROTA_OFICIAIS_CEST, ROTA_OFICIAIS_CFOP, ROTA_OFICIAIS_IBGE, ROTA_OFICIAIS_NCM, TABELAS_OFICIAIS_TELA } from './oficiais';

export const TELAS_CADASTROS_OUTROS: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_ESTOQUE]: LISTA_ESTOQUE,
  ...Object.fromEntries(TABELAS_OFICIAIS_TELA.map((t) => [t.rota, t.lista])),
};

/** Páginas do menu do cadastros que o shell registra a partir deste adaptador. Só leitura: `cadastros.ver`. */
export const PAGINAS_CADASTROS_OUTROS: readonly PaginaBase[] = [
  { menu: 'Estoque', titulo: 'Estoque', rota: ROTA_ESTOQUE, ver: 'cadastros.ver' },
  ...TABELAS_OFICIAIS_TELA.map((t) => ({ menu: t.menu, titulo: t.titulo, rota: t.rota, ver: 'cadastros.ver' as const })),
];

/** Rotas que este adaptador assume; o shell tira do `PAGINAS` do módulo as repetidas. */
export const ROTAS_DO_ADAPTADOR: ReadonlySet<string> = new Set(PAGINAS_CADASTROS_OUTROS.map((p) => p.rota));
