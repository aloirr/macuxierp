import type { ItemCalculo } from '../contracts';

/**
 * Aritmética inteira do Manual da NF-e: 2 casas, centavo mais próximo, meio para cima (valores não negativos).
 * Alíquotas em décimos de milésimo de ponto percentual, 4 casas (180000 = 18,0000%; 1000000 = 100%). Intermediários em BigInt; nada de float.
 */
export const BASE_PERCENTUAL = 1000000n;

/** round-half-up de n/d, com n >= 0 e d > 0. */
export function divArredonda(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/** valor (centavos) × percentual (décimos de milésimo de %), arredondado ao centavo. Nome próprio: o platform-sdk tem outro `aplicarAliquota`. */
export function aplicarPercentual(valor: number, percentual: number): number {
  return Number(divArredonda(BigInt(valor) * BigInt(percentual), BASE_PERCENTUAL));
}

/**
 * Valor da operação do item: vProd + frete + seguro + outras despesas − desconto (padrão do Manual da NF-e: as despesas acessórias
 * cobradas do adquirente integram a base; o desconto incondicional a reduz). BC comum de ICMS, IPI, PIS e COFINS (cada tributo
 * acrescenta ou subtrai a sua parte). Pode ser negativa: quem chama valida.
 */
export function valorOperacao(item: ItemCalculo): number {
  return item.valor_bruto_centavos + item.frete_centavos + item.seguro_centavos + item.outras_despesas_centavos - item.desconto_centavos;
}

/**
 * Valor por unidade (pauta): quantidade (até 4 casas, qTrib) × valor por unidade em décimos de milésimo de real (×10^4, vUnid 11v4),
 * devolvido em centavos, meio para cima. Escalas: q × 10^4 e vu × 10^4 dão 10^8 por real, logo 10^6 por centavo.
 */
export function valorPorUnidade(quantidade: number, valorUnidade4: number): number {
  const q4 = BigInt(Math.round(quantidade * 10000));
  return Number(divArredonda(q4 * BigInt(valorUnidade4), 1000000n));
}
