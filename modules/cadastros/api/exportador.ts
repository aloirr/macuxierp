/**
 * Exportação LGPD do cadastros (RF-CORE-06, RN-CORE-07): as tabelas do tenant da transação (RLS), uma lista de linhas por
 * tabela, para o worker juntar no `.zip`. Satisfaz a porta `ExportadorModulo` do worker (`apps/worker/src/exportacao-lgpd.ts`):
 * `{ modulo, exportar(tx) }`. Traz também o inativo (RN-CAD-08: nada é apagado). Ficam de fora as tabelas oficiais
 * (NCM, CEST, CFOP, CST, municípios, UF: referência pública, sem `tenant_id` do cliente).
 * O conteúdo é dado pessoal: vai só para o arquivo; esta função não loga nada.
 */
import type { ModuloId, Transacao } from '@macuxierp/platform-sdk';

/** Tabelas do tenant no schema `cadastros` (migração 0004), na ordem em que aparecem no zip. Nenhuma guarda segredo. */
export const TABELAS_EXPORTADAS = [
  'filial', 'condicao_pagamento', 'vendedor', 'tabela_preco', 'tabela_preco_item', 'cliente', 'cliente_endereco', 'cliente_contato',
  'produto', 'produto_unidade', 'estoque_saldo', 'estoque_movimento', 'consulta_externa',
] as const;

export const exportadorCadastros: { modulo: ModuloId; exportar(tx: Transacao): Promise<Record<string, readonly unknown[]>> } = {
  modulo: 'cadastros',
  async exportar(tx) {
    const saida: Record<string, readonly unknown[]> = {};
    for (const t of TABELAS_EXPORTADAS) saida[t] = await tx.consultar(`SELECT * FROM cadastros.${t} ORDER BY id`);
    return saida;
  },
};
