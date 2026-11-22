/**
 * Consumidor de `pedido.pedido.aprovado@1` (T-0013 §8.1): grava o pedido em `faturamento.pedido_a_faturar`, a fila "a faturar",
 * sem ler o schema `pedido`. Idempotente: o mesmo evento de novo não regrava; a linha só muda se o status pela situação ATUAL do pedido mudou (reentrega de aprovado antigo).
 * O worker garante no máximo uma aplicação por `(id, evento.id)`; ator `sistema`; roda na transação do tenant do evento.
 */
import { EVENTO_PEDIDO_APROVADO, PedidoAprovadoV1 } from '@macuxierp/pedido/contracts';
import type { ConsumidorEvento } from '@macuxierp/platform-sdk';
import { statusDaFila } from '../domain';
import type { PedidosAprovados, SituacaoPedidoDoPedido } from './portas';
import { pedidosAprovadosSql } from './sql';

const ID_CONSUMIDOR_PEDIDO_APROVADO = 'faturamento.fila-a-faturar' as const;

export interface DepsConsumidorPedidoAprovado {
  pedidos?: PedidosAprovados;
  /** A mesma porta da emissão (`criarConsultaParaFaturar` do pedido): o evento pode ser uma reentrega antiga, vale a situação ATUAL do pedido. */
  situacao: SituacaoPedidoDoPedido;
}

export function criarConsumidorPedidoAprovado({ pedidos = pedidosAprovadosSql, situacao }: DepsConsumidorPedidoAprovado): ConsumidorEvento {
  return {
    id: ID_CONSUMIDOR_PEDIDO_APROVADO,
    eventos: [EVENTO_PEDIDO_APROVADO],
    async tratar(evento, tx) {
      const pedido = PedidoAprovadoV1.parse(evento.payload);
      const status = statusDaFila(await situacao.situacao(tx, pedido.pedido_id));
      // Pedido cancelado: nunca entra na fila (se já estava, é marcado cancelado). Faturado ou parcial entra com o status certo.
      if (status === 'cancelado') await pedidos.marcarCancelado(tx, pedido.pedido_id);
      else await pedidos.gravar(tx, pedido, status);
    },
  };
}
