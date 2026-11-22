/**
 * Exportação LGPD do pedido (RF-CORE-06, RN-CORE-07): as 5 tabelas do schema `pedido` do tenant da transação (RLS), uma lista
 * de linhas por tabela, para o worker juntar no `.zip`. Satisfaz a porta `ExportadorModulo` do worker: `{ modulo, exportar(tx) }`.
 * Traz também o excluído (`deleted_at`): nada é apagado. O conteúdo tem dado pessoal (`cliente_retrato`): vai só para o arquivo;
 * esta função não loga nada. Nenhuma tabela guarda segredo.
 */
import type { ModuloId, Transacao } from '@macuxierp/platform-sdk';

/** Tabelas do schema `pedido` (migração 0012), na ordem em que aparecem no zip. */
export const TABELAS_EXPORTADAS = ['numeracao', 'pedido', 'pedido_item', 'pedido_evento', 'aprovacao'] as const;

export const exportadorPedido: { modulo: ModuloId; exportar(tx: Transacao): Promise<Record<string, readonly unknown[]>> } = {
  modulo: 'pedido',
  async exportar(tx) {
    const saida: Record<string, readonly unknown[]> = {};
    for (const t of TABELAS_EXPORTADAS) saida[t] = await tx.consultar(`SELECT * FROM pedido.${t} ORDER BY id`);
    return saida;
  },
};
