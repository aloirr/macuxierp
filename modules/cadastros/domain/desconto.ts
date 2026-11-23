/**
 * RN-CAD-11: o desconto máximo do produto vale em qualquer ordem de carga. O item de preço guarda se o desconto foi
 * herdado do produto (`desconto_herdado`) ou é próprio (gravado à mão pelo PUT de itens); só o herdado acompanha o produto.
 */
export interface DescontoDoItem {
  desconto_maximo_bp: number;
  desconto_herdado: boolean;
}

export interface DescontoNaCarga extends DescontoDoItem {
  /** Nem o produto nem o item têm desconto: a carga avisa. */
  semDesconto: boolean;
}

/** Desconto do item de preço que a carga grava (RN-CAD-11). `descontoProduto` nulo = produto sem desconto informado. */
export function descontoNaCargaDoPreco(existente: DescontoDoItem | null, descontoProduto: number | null): DescontoNaCarga {
  if (existente && !existente.desconto_herdado) return { desconto_maximo_bp: existente.desconto_maximo_bp, desconto_herdado: false, semDesconto: false };
  if (descontoProduto !== null) return { desconto_maximo_bp: descontoProduto, desconto_herdado: true, semDesconto: false };
  return { desconto_maximo_bp: existente?.desconto_maximo_bp ?? 0, desconto_herdado: true, semDesconto: true };
}

/** Itens herdados cujo desconto difere do produto: são os que a carga do produto atualiza e republica (RN-CAD-11). */
export function itensQueHerdam<T extends DescontoDoItem>(itens: readonly T[], descontoProduto: number): T[] {
  return itens.filter((i) => i.desconto_herdado && i.desconto_maximo_bp !== descontoProduto);
}
