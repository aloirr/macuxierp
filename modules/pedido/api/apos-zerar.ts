/**
 * Porta `aposZerarPedidos` do Zerar pedidos (RN-CAD-10, T-0093 critério 3; desenho: docs/desenho/T-0093.md).
 * Chamada pelo plugin `zeragem.ts` DEPOIS do `pedido.portal_zerar` e na MESMA transação (`comPlataforma`), com os ids apagados:
 * 1. libera o reenvio do FDV (o `pedido_recebido` deixa de bloquear; retornos pendentes saem da fila);
 * 2. descarta o `a_faturar` desses pedidos (`cancelado`).
 * O pedido não toca schema alheio: só chama as duas funções de lista fechada dos donos (molde de `portal_inativar_espelho`).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { ApagadoZerarPedidos } from '../contracts';

export type ApagadoApos = z.infer<typeof ApagadoZerarPedidos>;

export interface AposZerarPedidos {
  /** Devolve só contagens por tabela; qualquer erro sobe e desfaz a transação inteira do zerar. */
  aposZerarPedidos(tx: Transacao, tenant: string, pedidoIds: readonly string[]): Promise<ApagadoApos[]>;
}

/**
 * PONTO ÚNICO DE LIGAÇÃO com o SQL (migração 0065 do banco-dados). Nomes do desenho (§2); ajuste só aqui se a 0065 diferir.
 * `liberarReenvio` (modulo-integracao-fdv) devolve `{pedidos_liberados, retornos_descartados}`;
 * `descartarAFaturar` (modulo-faturamento) devolve `{a_faturar_cancelados}`.
 */
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

/** Implementação sobre as funções SQL; a `apps/api` a usa na composição quando a 0065 estiver no main. */
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
