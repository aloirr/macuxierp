/**
 * Porta de leitura para o Zerar por cadastro do /config (RN-CAD-10): quais pedidos têm nota ou título no faturamento.
 * Chama `faturamento.portal_pedidos_com_uso` (0063, só leitura, SECURITY DEFINER). Não apaga nada: nota autorizada, XML e evento fiscal nunca são tocados.
 * Estruturalmente compatível com `UsosFaturamentoPedidos` do pedido (sem importar o pedido/api; a apps/api liga).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { PedidosComUsoFaturamento } from '../contracts';

const RetornoBanco = z
  .object({ com_nota: z.array(z.string().uuid()), com_titulo: z.array(z.string().uuid()) })
  .transform((r) => ({ comNota: [...new Set(r.com_nota)], comTitulo: [...new Set(r.com_titulo)] }));

export function criarUsosPedidosFaturamento(): {
  pedidosComNotaOuTitulo(tx: Transacao, tenant: string, pedidoIds: readonly string[]): Promise<PedidosComUsoFaturamento>;
} {
  return {
    async pedidosComNotaOuTitulo(tx, tenant, pedidoIds) {
      const ids = [...new Set(pedidoIds)];
      if (ids.length === 0) return { comNota: [], comTitulo: [] };
      const [l] = await tx.consultar<{ r: unknown }>('SELECT faturamento.portal_pedidos_com_uso($1::uuid, $2::uuid[]) AS r', [tenant, ids]);
      if (!l) throw new Error('portal_pedidos_com_uso sem retorno');
      return RetornoBanco.parse(l.r);
    },
  };
}
