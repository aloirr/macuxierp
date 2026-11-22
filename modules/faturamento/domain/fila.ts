import type { SituacaoPedido } from './nota';

export type StatusFilaFaturar = 'a_faturar' | 'faturado_parcial' | 'faturado' | 'cancelado';

/**
 * RF-FAT-01: status do pedido na fila `pedido_a_faturar` a partir da situação ATUAL do pedido (a reentrega de um `pedido.pedido.aprovado@1` antigo
 * não pode ressuscitar pedido cancelado nem já faturado). Cancelado vence; sem saldo em nenhum item = faturado; algo faturado com saldo = parcial.
 */
export function statusDaFila(situacao: SituacaoPedido | null): StatusFilaFaturar {
  if (!situacao) return 'a_faturar';
  if (situacao.status === 'cancelado') return 'cancelado';
  const { itens } = situacao;
  if (itens.length > 0 && itens.every((i) => i.quantidade - i.quantidade_faturada <= 0)) return 'faturado';
  if (itens.some((i) => i.quantidade_faturada > 0)) return 'faturado_parcial';
  return 'a_faturar';
}
