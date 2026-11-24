/**
 * Consumidor de `pedido.pedido.aprovado@1` que põe o pedido aprovado na fila de descida (ADR 0014 §13 e §15: todo aprovado desce,
 * com ou sem faturamento). Mesma transação do evento; idempotente (reentrega não duplica). Fica FORA de `consumidoresDoPedido`
 * até a migração 0045 existir no banco: quem liga o worker o acrescenta à lista depois dela.
 */
import type { ConsumidorEvento, Relogio } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_APROVADO } from '../contracts';
import { criarServicoDescida, type DependenciasDescida } from './descida';

export const ID_CONSUMIDOR_DESCIDA = 'pedido.fila-descida' as const;

export function criarConsumidorDescida(d: DependenciasDescida & { relogio: Relogio }): ConsumidorEvento {
  const servico = criarServicoDescida(d);
  return {
    id: ID_CONSUMIDOR_DESCIDA,
    eventos: [EVENTO_PEDIDO_APROVADO],
    async tratar(evento, tx) {
      await servico.enfileirar(
        tx,
        { tenant_id: evento.tenant_id, ator: { tipo: 'sistema' }, agora: d.relogio.agora(), publicar: async () => '', auditar: async () => undefined },
        evento.agregado_id,
      );
    },
  };
}
