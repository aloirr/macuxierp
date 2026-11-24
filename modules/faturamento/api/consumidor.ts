/**
 * Consumidor de `pedido.pedido.aprovado@1` (T-0013 §8.1): grava o pedido em `faturamento.pedido_a_faturar`, a fila "a faturar",
 * sem ler o schema `pedido`. Idempotente: o mesmo evento de novo não regrava; a linha só muda se o status pela situação ATUAL do pedido mudou (reentrega de aprovado antigo).
 * O worker garante no máximo uma aplicação por `(id, evento.id)`; ator `sistema`; roda na transação do tenant do evento.
 */
import { EVENTO_PEDIDO_APROVADO, PedidoAprovadoV1 } from '@macuxierp/pedido/contracts';
import { ErroApi, type ConsumidorEvento } from '@macuxierp/platform-sdk';
import { statusDaFila } from '../domain';
import type { PedidosAprovados, SituacaoPedidoDoPedido } from './portas';
import { exigirFaturamentoLigado, type LicencaFaturamento, type LogCenarioB } from './cenario-b';
import { pedidosAprovadosSql } from './sql';

const ID_CONSUMIDOR_PEDIDO_APROVADO = 'faturamento.fila-a-faturar' as const;

export interface DepsConsumidorPedidoAprovado {
  pedidos?: PedidosAprovados;
  /** A mesma porta da emissão (`criarConsultaParaFaturar` do pedido): o evento pode ser uma reentrega antiga, vale a situação ATUAL do pedido. */
  situacao: SituacaoPedidoDoPedido;
  /** Licença do módulo faturamento (RN-CORE-02, cenário B). O worker injeta a do core; sem ela (legado) o consumidor segue ligado. */
  licenca?: LicencaFaturamento;
  log?: LogCenarioB;
}

export function criarConsumidorPedidoAprovado({ pedidos = pedidosAprovadosSql, situacao, licenca, log }: DepsConsumidorPedidoAprovado): ConsumidorEvento {
  return {
    id: ID_CONSUMIDOR_PEDIDO_APROVADO,
    eventos: [EVENTO_PEDIDO_APROVADO],
    async tratar(evento, tx) {
      const pedido = PedidoAprovadoV1.parse(evento.payload);
      // Faturamento desligado: o ERP não cria fila nem emite nota (ADR 0014 §15); ignora com log sem dado pessoal.
      if (licenca) {
        try {
          await exigirFaturamentoLigado(licenca, tx, evento.tenant_id);
        } catch (e) {
          if (e instanceof ErroApi && e.status === 409) {
            log?.({ evento: 'faturamento.pedido.ignorado_faturamento_desligado', pedido_id: pedido.pedido_id, motivo: 'faturamento_desligado' });
            return;
          }
          throw e;
        }
      }
      const status = statusDaFila(await situacao.situacao(tx, pedido.pedido_id));
      // Pedido cancelado: nunca entra na fila (se já estava, é marcado cancelado). Faturado ou parcial entra com o status certo.
      if (status === 'cancelado') await pedidos.marcarCancelado(tx, pedido.pedido_id);
      else await pedidos.gravar(tx, pedido, status);
    },
  };
}
