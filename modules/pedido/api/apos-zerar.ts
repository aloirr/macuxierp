/**
 * Porta `aposZerarPedidos` (RN-CAD-10, T-0093 critério 3; docs/desenho/T-0093.md).
 * Mesma tx do `portal_zerar`: erro sobe e desfaz o zerar.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import type { ApagadoZerarPedidos } from '../contracts';

export interface AposZerarPedidos {
  /** Devolve só contagens por tabela. */
  aposZerarPedidos(tx: Transacao, tenant: string, pedidoIds: readonly string[]): Promise<ApagadoZerarPedidos[]>;
}

/** PONTO ÚNICO DE LIGAÇÃO com o SQL (migração 0065). */
export const FUNCOES_APOS_ZERAR_PEDIDOS = Object.freeze({
  liberarReenvio: 'integracao_fdv.portal_liberar_reenvio_pedidos',
  descartarAFaturar: 'faturamento.portal_descartar_a_faturar',
});

const ResultadoReenvio = z.object({ pedidos_liberados: z.number().int().min(0), retornos_descartados: z.number().int().min(0) });
const ResultadoAFaturar = z.object({ a_faturar_cancelados: z.number().int().min(0) });

async function chamar(tx: Transacao, funcao: string, tenant: string, ids: readonly string[]): Promise<unknown> {
  const [l] = await tx.consultar<{ r: unknown }>(`SELECT ${funcao}($1::uuid, $2::uuid[]) AS r`, [tenant, ids]);
  if (!l) throw new Error(`${funcao} sem retorno`);
  return l.r;
}

/** Implementação sobre as funções SQL da 0065. */
export function criarAposZerarPedidosSql(): AposZerarPedidos {
  return {
    async aposZerarPedidos(tx, tenant, ids) {
      if (ids.length === 0) return [];
      const reenvio = ResultadoReenvio.parse(await chamar(tx, FUNCOES_APOS_ZERAR_PEDIDOS.liberarReenvio, tenant, ids));
      const afaturar = ResultadoAFaturar.parse(await chamar(tx, FUNCOES_APOS_ZERAR_PEDIDOS.descartarAFaturar, tenant, ids));
      return [
        { tabela: 'integracao_fdv.pedido_recebido', quantidade: reenvio.pedidos_liberados },
        { tabela: 'integracao_fdv.retorno_enviado', quantidade: reenvio.retornos_descartados },
        { tabela: 'faturamento.pedido_a_faturar', quantidade: afaturar.a_faturar_cancelados },
      ];
    },
  };
}
