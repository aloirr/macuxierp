/**
 * Consumidor de `pedido.pedido.aprovado@1` (T-0013 §8.1): grava o pedido em `faturamento.pedido_a_faturar`, a fila "a faturar",
 * sem ler o schema `pedido`. Idempotente: o mesmo evento (ou o mesmo pedido) de novo não grava de novo (`ON CONFLICT DO NOTHING`).
 * O worker garante no máximo uma aplicação por `(id, evento.id)`; ator `sistema`; roda na transação do tenant do evento.
 */
import { EVENTO_PEDIDO_APROVADO, PedidoAprovadoV1 } from '@macuxierp/pedido/contracts';
import type { ConsumidorEvento } from '@macuxierp/platform-sdk';
import type { PedidosAprovados } from './portas';
import { pedidosAprovadosSql } from './sql';

const ID_CONSUMIDOR_PEDIDO_APROVADO = 'faturamento.fila-a-faturar' as const;

export function criarConsumidorPedidoAprovado(pedidos: PedidosAprovados = pedidosAprovadosSql): ConsumidorEvento {
  return {
    id: ID_CONSUMIDOR_PEDIDO_APROVADO,
    eventos: [EVENTO_PEDIDO_APROVADO],
    async tratar(evento, tx) {
      await pedidos.gravar(tx, PedidoAprovadoV1.parse(evento.payload));
    },
  };
}
