/**
 * Descritor da lista de pedidos (T-0041, RD-0121): a tela do BKO e a rota `GET /v1/pedido/pedidos[/exportar]` usam o
 * mesmo. Sem React nem Node: serve ao `web` e à `api`. Filtros na URL, colunas na tabela e no CSV (RF-PED-05).
 */
import { definirPaginaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import { Uuid } from '@macuxierp/cadastros/contracts';
import { z } from 'zod';
import { OrigemPedido, PedidoLista, StatusPedido } from '../contracts';

/** Linha da lista; `cliente_documento` só vem no CSV de quem pode ver o documento (nunca para o vendedor). */
export const ItemListaPedido = PedidoLista.extend({ cliente_documento: z.string().nullable().optional() });
export type ItemListaPedido = z.infer<typeof ItemListaPedido>;

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** `1234` centavos → `12,34` (CSV no padrão do Excel pt-BR). */
const reais = (centavos: number): string => `${Math.trunc(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;

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
  { id: 'total_centavos', titulo: 'Total (R$)', valor: (p) => reais(p.total_centavos) },
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
