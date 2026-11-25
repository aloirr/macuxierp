// Zerar pedidos não faturados por cadastro (RN-CAD-10, T-0093). Plano puro: não toca no banco; o efeito roda na função do
// banco, que reconfere os ids com FOR UPDATE. Só decide quais pedidos saem e quais ficam. Nada fiscal entra aqui: nota
// autorizada, XML e evento fiscal nunca são apagados (regra 7); o pedido com nota simplesmente fica.
import type { StatusPedido } from '../contracts';

/** Fato de um pedido, injetado: `com_nota` e `com_titulo` vêm do faturamento (porta), nunca de tabela dele. */
export interface PedidoParaZerar {
  id: string;
  status: StatusPedido;
  origem: 'fdv' | 'bko';
  com_nota: boolean;
  com_titulo: boolean;
}

export type MotivoManterPedido = 'nota' | 'titulo';

export interface PlanoZeragemPedidos {
  /** Ids a apagar (pedido sem nota e sem título). */
  apagar: string[];
  /** Dos `apagar`, quantos vieram do FDV. */
  apagarFdv: number;
  /** Quantidade mantida por motivo; com os dois, conta o mais forte (nota). */
  mantidos: { motivo: MotivoManterPedido; quantidade: number }[];
}

/** Status que só existem com nota emitida (RN-PED-02). */
const STATUS_COM_NOTA: readonly StatusPedido[] = ['faturado_parcial', 'faturado'];

/**
 * RN-CAD-10: apaga só o pedido sem nota e sem título. Nota vence título como motivo. Pedido faturado ou faturado parcial
 * fica mesmo que a porta não ache a nota (conservador: o apagado não volta). Recusado, cancelado e em andamento sem nota
 * nem título saem, inclusive os do FDV (só voltam pelo reenvio do FDV).
 */
export function planoZeragemPedidos(pedidos: readonly PedidoParaZerar[]): PlanoZeragemPedidos {
  const apagar: string[] = [];
  let apagarFdv = 0;
  const mantidos = { nota: 0, titulo: 0 };
  for (const p of pedidos) {
    if (p.com_nota || STATUS_COM_NOTA.includes(p.status)) mantidos.nota++;
    else if (p.com_titulo) mantidos.titulo++;
    else {
      apagar.push(p.id);
      if (p.origem === 'fdv') apagarFdv++;
    }
  }
  return {
    apagar,
    apagarFdv,
    mantidos: (['nota', 'titulo'] as const).filter((m) => mantidos[m] > 0).map((m) => ({ motivo: m, quantidade: mantidos[m] })),
  };
}
