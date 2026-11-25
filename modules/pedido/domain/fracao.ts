import { validarFracaoDaQuantidade } from '@macuxierp/cadastros/contracts';
import { violacao, type Violacao } from './violacao';

/** Item com a quantidade (Qtd4) e a unidade comercial do produto, a unidade em que a quantidade está (`ProdutoParaPedido`). */
export interface ItemComUnidade {
  quantidade: number;
  unidade_comercial: string | null | undefined;
}

/**
 * RN-CAD-17: fração só em KG e M. A regra é a do cadastros (`validarFracaoDaQuantidade`); aqui só se aplica item a item.
 * Pedido manual: vira 422 `RN-CAD-17` em `itens[N].quantidade`. Pedido do FDV (RN-PED-01): o primeiro motivo recusa o recebimento.
 */
export function verificarFracaoDosItens(itens: readonly ItemComUnidade[]): Violacao[] {
  const v: Violacao[] = [];
  for (const [n, i] of itens.entries()) {
    const r = validarFracaoDaQuantidade(i.unidade_comercial, i.quantidade);
    if (!r.ok) v.push(violacao('RN-CAD-17', `itens[${n}].quantidade`, r.motivo));
  }
  return v;
}
