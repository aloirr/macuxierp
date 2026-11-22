/**
 * Porta `SituacaoPedidoParaFaturar` (T-0013 §8.1): o faturamento a chama na transação que reserva o número da nota, para
 * não emitir sobre pedido cancelado nem faturar acima do saldo. `FOR SHARE` no pedido: uma transição concorrente
 * (cancelamento) espera a nota reservar, e a nota enxerga o status confirmado. Pedido de outro tenant não aparece (RLS).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { SituacaoPedidoParaFaturar, StatusPedido } from '../contracts';

export interface ConsultaParaFaturar {
  situacao(tx: Transacao, pedidoId: string): Promise<SituacaoPedidoParaFaturar | null>;
}

export function criarConsultaParaFaturar(): ConsultaParaFaturar {
  return {
    async situacao(tx, pedidoId) {
      const [p] = await tx.consultar<{ status: StatusPedido }>('SELECT status FROM pedido.pedido WHERE id = $1 AND deleted_at IS NULL FOR SHARE', [pedidoId]);
      if (!p) return null;
      const itens = await tx.consultar<SituacaoPedidoParaFaturar['itens'][number]>(
        'SELECT sequencia, quantidade::float8 AS quantidade, quantidade_faturada::float8 AS quantidade_faturada FROM pedido.pedido_item WHERE pedido_id = $1 AND deleted_at IS NULL ORDER BY sequencia',
        [pedidoId],
      );
      return { status: p.status, itens };
    },
  };
}
