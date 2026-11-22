/**
 * Descritor da lista de pedidos (T-0041, RD-0121): a tela do BKO e a rota `GET /v1/pedido/pedidos[/exportar]` usam o
 * mesmo. Sem React nem Node: serve ao `web` e à `api`. Filtros na URL, colunas na tabela e no CSV (RF-PED-05).
 */
import type { PaginaBase } from '@macuxierp/platform-sdk/paginas';
import { definirPaginaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import { Uuid } from '@macuxierp/cadastros/contracts';
import { z } from 'zod';
import { formatarCentavos } from '@macuxierp/platform-sdk/formatar';
import { OrigemPedido, PedidoLista, StatusPedido } from '../contracts';

/** Linha da lista; `cliente_documento` só vem no CSV de quem pode ver o documento (nunca para o vendedor). */
export const ItemListaPedido = PedidoLista.extend({ cliente_documento: z.string().nullable().optional() });
export type ItemListaPedido = z.infer<typeof ItemListaPedido>;

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const COLUNA_DOCUMENTO = 'cliente_documento';

const colunasPedidos: readonly ColunaLista<ItemListaPedido>[] = [
  { id: 'numero', titulo: 'Número', valor: (p) => p.numero },
  { id: 'origem', titulo: 'Origem', valor: (p) => p.origem },
  { id: 'status', titulo: 'Status', valor: (p) => p.status },
  { id: 'emitido_em', titulo: 'Emitido em (UTC)', valor: (p) => p.emitido_em },
  { id: 'cliente_razao_social', titulo: 'Cliente', valor: (p) => p.cliente_razao_social },
  { id: COLUNA_DOCUMENTO, titulo: 'Documento do cliente', valor: (p) => p.cliente_documento },
  { id: 'filial_id', titulo: 'Filial', valor: (p) => p.filial_id },
  { id: 'vendedor_id', titulo: 'Vendedor', valor: (p) => p.vendedor_id },
  { id: 'total_centavos', titulo: 'Total (R$)', valor: (p) => formatarCentavos(p.total_centavos) },
  { id: 'pendencias', titulo: 'Pendências', valor: (p) => p.pendencias },
];

export const paginaPedidos = definirPaginaLista({
  id: 'pedidos',
  api: '/v1/pedido/pedidos',
  item: ItemListaPedido,
  busca: true,
  filtros: {
    status: StatusPedido.optional(),
    cliente_id: Uuid.optional(),
    vendedor_id: Uuid.optional(),
    filial_id: Uuid.optional(),
    origem: OrigemPedido.optional(),
    de: DATA.optional(),
    ate: DATA.optional(),
  },
  colunas: colunasPedidos,
  csv: { arquivo: 'pedidos.csv' },
});

// ---- Páginas do BKO (T-0015, lote 3): rotas, menu e permissões como dados; o shell desenha ----

export type TipoPaginaPedido = 'lista' | 'detalhe' | 'novo' | 'editar';

export interface PaginaPedido extends PaginaBase {
  readonly id: string;
  readonly tipo: TipoPaginaPedido;
}

/**
 * Ordem: lista, novo, detalhe, editar. `/novo` vem antes de `/:id`, para o fixo vencer o parâmetro; `/:id/editar` tem outro tamanho.
 * `editar` só vale para o pedido `bko` em `em_analise` (`acoesDoPedido`/`possiveis`); usa `formularioDoPedido` e o PUT com `If-Match`.
 */
export const PAGINAS_PEDIDO: readonly PaginaPedido[] = [
  { id: 'pedidos', tipo: 'lista', menu: 'Pedidos', titulo: 'Pedidos', rota: '/pedido/pedidos', ver: 'pedido.ver' },
  { id: 'novo', tipo: 'novo', menu: 'Pedidos', titulo: 'Novo pedido', rota: '/pedido/pedidos/novo', ver: 'pedido.pedido.lancar', ocultaNoMenu: true },
  { id: 'detalhe', tipo: 'detalhe', menu: 'Pedidos', titulo: 'Pedido', rota: '/pedido/pedidos/:id', ver: 'pedido.ver', ocultaNoMenu: true },
  { id: 'editar', tipo: 'editar', menu: 'Pedidos', titulo: 'Editar pedido', rota: '/pedido/pedidos/:id/editar', ver: 'pedido.pedido.lancar', ocultaNoMenu: true },
];
