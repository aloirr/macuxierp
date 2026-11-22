/** Total do formulário em centavos, sem regra nova: valor do item (SDK) menos desconto, como o `domain` calcula (RN-PED-03). */
import { totalItem, totalPedido } from '../domain';

export interface ItemParaTotal {
  /** Qtd4: quantidade × 10^4. */
  quantidade: number;
  preco_unitario_centavos: number;
  desconto_centavos: number;
}

/** `itens[i]` = total da linha i (valorItem − desconto); `total` = soma. Desconto acima do valor lança `EntradaIncoerente`. */
export function calcularTotal(itens: readonly ItemParaTotal[]): { itens: number[]; total: number } {
  const linhas = itens.map((i, indice) => totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, indice));
  return { itens: linhas, total: totalPedido(itens.map((i, n) => ({ sequencia: n + 1, ...i }))) };
}
