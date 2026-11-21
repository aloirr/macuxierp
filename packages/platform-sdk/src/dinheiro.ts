/**
 * Dinheiro em centavos (regra inegociável 4). Inteiro, nunca float.
 * Arredondamento do Manual da NF-e (Anexo I, "regras de arredondamento"): meio para cima na 2ª casa
 * (ABNT NBR 5891 nos casos de empate exato é decisão da ADR do fiscal; aqui o padrão é meio para cima).
 */
export type Centavos = number & { readonly __centavos: unique symbol };

export function centavos(valor: number): Centavos {
  if (!Number.isSafeInteger(valor)) throw new RangeError(`centavos: ${valor} não é inteiro seguro`);
  return valor as Centavos;
}

/** Aplica uma alíquota em percentual (ex.: 18 ou 1.65) sobre uma base em centavos, arredondando meio para cima. */
export function aplicarAliquota(base: Centavos, aliquotaPct: number): Centavos {
  // Escala inteira para fugir do erro binário: alíquota com até 4 casas (o leiaute da NF-e usa até 4).
  const aliquota4 = Math.round(aliquotaPct * 10_000);
  const bruto = BigInt(base) * BigInt(aliquota4); // centavos × (pct × 10^4)
  const divisor = 100n * 10_000n;
  const q = bruto / divisor;
  const r = bruto % divisor;
  const sinal = bruto < 0n ? -1n : 1n;
  const arred = (r < 0n ? -r : r) * 2n >= divisor ? q + sinal : q;
  return centavos(Number(arred));
}

/** Rateia um total em parcelas sem perder centavo: a diferença vai para a primeira parcela. */
export function ratear(total: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes < 1) throw new RangeError('ratear: partes deve ser inteiro >= 1');
  const base = Math.trunc(total / partes);
  const resto = total - base * partes;
  return Array.from({ length: partes }, (_, i) => centavos(i === 0 ? base + resto : base));
}
