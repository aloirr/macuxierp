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
