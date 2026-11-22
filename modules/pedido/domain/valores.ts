import { violacao, type Violacao } from './violacao';

const DEZ4 = 10_000n;

/**
 * Valor do item: arred(qtd4 × preço_unitário / 10⁴), meio para cima (RN-CORE-03, como o vProd da NF-e), em BigInt.
 * Provisório até o valorItem do SDK (T-0013 §9).
 */
export function valorItem(qtd4: number, precoCentavos: number): number {
  const bruto = BigInt(qtd4) * BigInt(precoCentavos);
  const q = bruto / DEZ4;
  const r = bruto % DEZ4;
  const valor = Number(r * 2n >= DEZ4 ? q + 1n : q);
  if (!Number.isSafeInteger(valor)) throw new RangeError('Valor do item fora do intervalo inteiro seguro');
  return valor;
}

/** Erro de entrada incoerente (não é pendência): a API devolve 422 `RN-PED-03` no campo indicado. */
export class EntradaIncoerente extends Error {
  constructor(public readonly violacao: Violacao) {
    super(violacao.mensagem);
  }
}

/** Total do item = valor − desconto. Desconto maior que o valor é entrada incoerente; `indice` (base 0) aponta `itens[i]`. */
export function totalItem(qtd4: number, precoCentavos: number, descontoCentavos: number, indice: number): number {
  const total = valorItem(qtd4, precoCentavos) - descontoCentavos;
  if (total < 0) {
    throw new EntradaIncoerente(violacao('RN-PED-03', `itens[${indice}].desconto_centavos`, 'O desconto não pode passar do valor do item'));
  }
  return total;
}

export interface ItemValor {
  sequencia: number;
  quantidade: number;
  preco_unitario_centavos: number;
  desconto_centavos: number;
}

/** Confere a coerência dos itens antes de avaliar; a API chama e devolve as violações. */
export function verificarItens(itens: readonly ItemValor[]): Violacao[] {
  const v: Violacao[] = [];
  for (const [indice, i] of itens.entries()) {
    try {
      totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, indice);
    } catch (e) {
      if (e instanceof EntradaIncoerente) v.push(e.violacao);
      else throw e;
    }
  }
  return v;
}

/** Soma do total dos itens (sem rateio no pedido). */
export const totalPedido = (itens: readonly ItemValor[]): number =>
  itens.reduce((s, i, indice) => s + totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, indice), 0);
