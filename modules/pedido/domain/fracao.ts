import { validarFracaoDaQuantidade } from '@macuxierp/cadastros/contracts';
import { violacao, type Violacao } from './violacao';

/** Item do pedido: a quantidade (Qtd4) está na unidade comercial do produto (`ProdutoParaPedido`). */
export interface ItemParaFracao {
  produto_id: string;
  quantidade: number;
}

/**
 * RN-CAD-17: fração só em KG e M. A regra é a do cadastros (`validarFracaoDaQuantidade`); aqui só se aplica item a item.
 * Pedido manual: vira 422 `RN-CAD-17` em `itens[N].quantidade`. Pedido do FDV (RN-PED-01): o primeiro motivo recusa o recebimento.
 */
export function verificarFracaoDosItens(itens: readonly ItemParaFracao[], unidadeDoProduto: (produtoId: string) => string | null | undefined): Violacao[] {
  const v: Violacao[] = [];
  for (const [n, i] of itens.entries()) {
    const r = validarFracaoDaQuantidade(unidadeDoProduto(i.produto_id), i.quantidade);
    if (!r.ok) v.push(violacao('RN-CAD-17', `itens[${n}].quantidade`, r.motivo));
  }
  return v;
}
