import type { ItemCalculo } from '../contracts';

/**
 * Aritmética inteira do Manual da NF-e: 2 casas, centavo mais próximo, meio para cima (valores não negativos).
 * Alíquotas em décimos de milésimo de ponto percentual, 4 casas (180000 = 18,0000%; 1000000 = 100%). Intermediários em BigInt; nada de float.
 */
export const BASE_PERCENTUAL = 1000000n;

/**
 * Modo de arredondamento ao centavo. Padrão desta função: 'meio_para_cima' (RN-CORE-03, Manual da NF-e: ICMS, IPI, PIS e COFINS).
 * 'meio_para_par' (desempate para o par, ABNT NBR 5891) é o modo do IBS, CBS e IS, por decisão do Alexandre em 22/11/2026, igual à Calculadora RTC
 * da RFB (HALF_EVEN; github.com/ReceitaFederal/calculadora-rtc-regime-regular). Só os cálculos de IBS/CBS/IS o usam (RN-FIS-03).
 */
export type ModoArredondamento = 'meio_para_cima' | 'meio_para_par';

/** Divisão inteira de n/d (n >= 0, d > 0) arredondada ao inteiro mais próximo; no empate exato, para cima ou para o par, conforme o modo. */
export function divArredonda(n: bigint, d: bigint, modo: ModoArredondamento = 'meio_para_cima'): bigint {
  if (modo === 'meio_para_cima') return (2n * n + d) / (2n * d);
  const q = n / d;
  const dobro = 2n * (n % d);
  if (dobro > d) return q + 1n;
  if (dobro === d) return q % 2n === 0n ? q : q + 1n;
  return q;
}

/** valor (centavos) × percentual (décimos de milésimo de %), arredondado ao centavo. Nome próprio: o platform-sdk tem outro `aplicarAliquota`. */
export function aplicarPercentual(valor: number, percentual: number, modo: ModoArredondamento = 'meio_para_cima'): number {
  return Number(divArredonda(numeradorPercentual(valor, percentual), BASE_PERCENTUAL, modo));
}

/** Valor × percentual na escala exata (÷ 10^6 dá centavos), sem arredondar: permite somar partes e arredondar uma vez (IS combinado). */
export function numeradorPercentual(valor: number, percentual: number): bigint {
  return BigInt(valor) * BigInt(percentual);
}

/** Quantidade × valor por unidade na mesma escala exata de `numeradorPercentual` (÷ 10^6 dá centavos). */
export function numeradorPorUnidade(quantidade: number, valorUnidade4: number): bigint {
  return BigInt(Math.round(quantidade * 10000)) * BigInt(valorUnidade4);
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
export function valorPorUnidade(quantidade: number, valorUnidade4: number, modo: ModoArredondamento = 'meio_para_cima'): number {
  return Number(divArredonda(numeradorPorUnidade(quantidade, valorUnidade4), BASE_PERCENTUAL, modo));
}
