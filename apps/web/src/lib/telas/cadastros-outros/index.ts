/**
 * Cadastros fora do núcleo (T-0123): Estoque e Tabelas oficiais (lote A). Condições, Equipe e itens de preço entram no lote B.
 * Daqui saem as telas (por rota) e as páginas do menu; `lib/telas.ts` e `lib/paginas.ts` só somam estes mapas.
 */
import type { PaginaBase } from '@macuxierp/platform-sdk';
import type { TelaDescrita } from '../../descritor/tipos';
import { LISTA_ESTOQUE, ROTA_ESTOQUE } from './estoque';
import { TABELAS_OFICIAIS_TELA } from './oficiais';
import {
  EDITAR_CONDICAO, EDITAR_VENDEDOR, LISTA_CONDICOES, LISTA_EQUIPE, NOVA_CONDICAO, NOVO_VENDEDOR, ROTA_CONDICAO, ROTA_CONDICAO_NOVA, ROTA_CONDICOES, ROTA_EQUIPE, ROTA_TRANSFERIR_CARTEIRA, ROTA_VENDEDOR,
  ROTA_VENDEDOR_NOVO, TRANSFERIR_CARTEIRA,
} from './condicoes-equipe';

export { LISTA_ESTOQUE, ROTA_ESTOQUE, paginaEstoque } from './estoque';
export { ROTA_CONDICAO, ROTA_CONDICAO_NOVA, ROTA_CONDICOES, ROTA_EQUIPE, ROTA_TRANSFERIR_CARTEIRA, ROTA_VENDEDOR, ROTA_VENDEDOR_NOVO } from './condicoes-equipe';
export { ROTA_OFICIAIS, ROTA_OFICIAIS_CEST, ROTA_OFICIAIS_CFOP, ROTA_OFICIAIS_IBGE, ROTA_OFICIAIS_NCM, TABELAS_OFICIAIS_TELA } from './oficiais';

export const TELAS_CADASTROS_OUTROS: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_ESTOQUE]: LISTA_ESTOQUE,
  [ROTA_CONDICOES]: LISTA_CONDICOES,
  [ROTA_CONDICAO_NOVA]: NOVA_CONDICAO,
  [ROTA_CONDICAO]: EDITAR_CONDICAO,
  [ROTA_EQUIPE]: LISTA_EQUIPE,
  [ROTA_VENDEDOR_NOVO]: NOVO_VENDEDOR,
  [ROTA_TRANSFERIR_CARTEIRA]: TRANSFERIR_CARTEIRA,
  [ROTA_VENDEDOR]: EDITAR_VENDEDOR,
  ...Object.fromEntries(TABELAS_OFICIAIS_TELA.map((t) => [t.rota, t.lista])),
};

/** Páginas do menu do cadastros que o shell registra a partir deste adaptador. Só leitura: `cadastros.ver`. */
export const PAGINAS_CADASTROS_OUTROS: readonly PaginaBase[] = [
  { menu: 'Estoque', titulo: 'Estoque', rota: ROTA_ESTOQUE, ver: 'cadastros.ver' },
  { menu: 'Condições de pagamento', titulo: 'Condições de pagamento', rota: ROTA_CONDICOES, ver: 'cadastros.ver' },
  { menu: 'Condições de pagamento', titulo: 'Nova condição', rota: ROTA_CONDICAO_NOVA, ver: 'cadastros.condicao_pagamento.editar', ocultaNoMenu: true },
  { menu: 'Condições de pagamento', titulo: 'Condição de pagamento', rota: ROTA_CONDICAO, ver: 'cadastros.ver', ocultaNoMenu: true },
  { menu: 'Equipe e carteira', titulo: 'Equipe e carteira', rota: ROTA_EQUIPE, ver: 'cadastros.ver' },
  { menu: 'Equipe e carteira', titulo: 'Transferir carteira', rota: ROTA_TRANSFERIR_CARTEIRA, ver: 'cadastros.carteira.transferir' },
  { menu: 'Equipe e carteira', titulo: 'Novo vendedor', rota: ROTA_VENDEDOR_NOVO, ver: 'cadastros.vendedor.editar', ocultaNoMenu: true },
  { menu: 'Equipe e carteira', titulo: 'Vendedor', rota: ROTA_VENDEDOR, ver: 'cadastros.ver', ocultaNoMenu: true },
  ...TABELAS_OFICIAIS_TELA.map((t) => ({ menu: t.menu, titulo: t.titulo, rota: t.rota, ver: 'cadastros.ver' as const })),
];

/** Rotas que este adaptador assume; o shell tira do `PAGINAS` do módulo as repetidas. */
export const ROTAS_DO_ADAPTADOR: ReadonlySet<string> = new Set(PAGINAS_CADASTROS_OUTROS.map((p) => p.rota));
