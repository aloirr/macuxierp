/**
 * Estoque no BKO (T-0123, v0.3.32): saldo por filial e produto, só leitura (RN-CAD-07; o movimento entra pelo POST /estoque/movimentos,
 * que não tem tela nesta versão). Filial e produto saem como nome nas colunas pelo mesmo seletor dos filtros; a busca e a paginação por
 * cursor são do servidor. Nenhuma regra de negócio aqui. Sem dado pessoal.
 */
import { SaldoEstoqueItem } from '@macuxierp/cadastros/contracts';
import { formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import type { TelaLista } from '../../descritor/tipos';

export const ROTA_ESTOQUE = '/cadastros/estoque';
export const API_ESTOQUE = '/v1/cadastros/estoque';

export const paginaEstoque = definirPaginaLista({
  id: 'estoque', api: API_ESTOQUE, item: SaldoEstoqueItem, busca: true,
  filtros: { filial_id: z.string().uuid().optional(), produto_id: z.string().uuid().optional() },
  colunas: [
    { id: 'filial_id', titulo: 'Filial', valor: (s) => s.filial_id },
    { id: 'produto_id', titulo: 'Produto', valor: (s) => s.produto_id },
    { id: 'quantidade', titulo: 'Saldo', valor: (s) => formatarQuantidade(s.quantidade) },
  ],
  csv: false,
  vazio: { semFiltro: 'Nenhum saldo de estoque lançado.', comFiltro: 'Nenhum saldo com estes filtros.' },
});

export const LISTA_ESTOQUE: TelaLista = {
  tipo: 'lista',
  pagina: paginaEstoque as unknown as TelaLista['pagina'],
  rotuloBusca: 'Produto ou filial',
  filtrosTela: [
    { chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais', colunas: 3 },
    { chave: 'produto_id', rotulo: 'Produto', tipo: 'cadastro', fonte: '/v1/cadastros/produtos', colunas: 4 },
  ],
  colunas: () => [{ id: 'filial_id', rotulo: 'Filial' }, { id: 'produto_id', rotulo: 'Produto' }, { id: 'quantidade', rotulo: 'Saldo', tipo: 'numero' }],
  linha: (item) => ({
    filial_id: String(item.filial_id ?? ''), produto_id: String(item.produto_id ?? ''),
    quantidade: typeof item.quantidade === 'number' ? formatarQuantidade(item.quantidade) : '',
  }),
};
