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

/** Status da fila em que a UI oferece "Emitir nota" (RF-FAT-01). */
export const STATUS_FILA_EMITE = ['a_faturar', 'faturado_parcial'] as const;

/**
 * RN-CAD-10: a linha `cancelado` (pedido zerado no /config, ou pedido cancelado) não aceita nota nova; o saldo já é conferido por `ratearItens`.
 * Só `cancelado` é recusado aqui; `faturado` (sem saldo) fica com `ratearItens` (RN-FAT-01). Par da UI: `acoesDoPedidoAFaturar` (usa `STATUS_FILA_EMITE`).
 */
export function filaAceitaNota(status: StatusFilaFaturar): boolean {
  return status !== 'cancelado';
}
