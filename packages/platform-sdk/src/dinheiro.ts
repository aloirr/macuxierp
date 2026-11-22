/**
 * Dinheiro em centavos (regra inegociável 4). Inteiro, nunca float. Fonte única do arredondamento (RN-CORE-03).
 * Empate: meio para cima (ICMS, IPI, PIS, COFINS e vProd); meio-para-par (ABNT NBR 5891) em IBS, CBS e IS (adendo da
 * ADR 0002). Fora do empate exato os dois modos dão o mesmo resultado.
 */
export type Centavos = number & { readonly __centavos: unique symbol };

export function centavos(valor: number): Centavos {
  if (!Number.isSafeInteger(valor)) throw new RangeError(`centavos: ${valor} não é inteiro seguro`);
  return valor as Centavos;
}

/** Critério do empate exato (ver o cabeçalho): `meio-para-cima` é o padrão; `meio-para-par` é o de IBS, CBS e IS. */
export type ModoArredondamento = 'meio-para-cima' | 'meio-para-par';

/**
 * Divisão inteira arredondada (divisor > 0). No negativo, o arredondamento é simétrico (longe do zero no
 * meio para cima; o vizinho par no meio-para-par). RangeError com divisor zero ou negativo.
 */
export function dividirArredondando(numerador: bigint, divisor: bigint, modo: ModoArredondamento = 'meio-para-cima'): bigint {
  if (divisor <= 0n) throw new RangeError('dividirArredondando: divisor deve ser positivo');
  const negativo = numerador < 0n;
  const abs = negativo ? -numerador : numerador;
  let q = abs / divisor;
  const dobro = (abs % divisor) * 2n;
  if (dobro > divisor || (dobro === divisor && (modo === 'meio-para-cima' || q % 2n === 1n))) q += 1n;
  return negativo ? -q : q;
}

/** Aplica uma alíquota em percentual (ex.: 18 ou 1.65) sobre uma base em centavos, arredondando na 2ª casa pelo `modo`. */
export function aplicarAliquota(base: Centavos, aliquotaPct: number, modo: ModoArredondamento = 'meio-para-cima'): Centavos {
  // Escala inteira para fugir do erro binário: alíquota com até 4 casas (o leiaute da NF-e usa até 4).
  const aliquota4 = Math.round(aliquotaPct * 10_000);
  const bruto = BigInt(base) * BigInt(aliquota4); // centavos × (pct × 10^4)
  return centavos(Number(dividirArredondando(bruto, 100n * 10_000n, modo)));
}

/**
 * Valor do item: arred(qtd4 × preço_unitário_centavos / 10⁴), meio para cima na 2ª casa (RN-CORE-03), como o
 * `vProd = qCom × vUnCom` do Manual da NF-e. `qtd4` é a quantidade em escala 4 (1 un = 10 000). Conta em BigInt;
 * RangeError se a entrada ou o resultado sair do inteiro seguro. É a mesma conta no pedido e no faturamento (T-0013 §3.1).
 */
export function valorItem(qtd4: number, precoCentavos: number): Centavos {
  if (!Number.isSafeInteger(qtd4)) throw new RangeError(`valorItem: quantidade ${qtd4} não é inteiro seguro`);
  if (!Number.isSafeInteger(precoCentavos)) throw new RangeError(`valorItem: preço ${precoCentavos} não é inteiro seguro`);
  return centavos(Number(dividirArredondando(BigInt(qtd4) * BigInt(precoCentavos), 10_000n)));
}

/** Rateia um total em parcelas sem perder centavo: a diferença vai para a primeira parcela. */
export function ratear(total: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes < 1) throw new RangeError('ratear: partes deve ser inteiro >= 1');
  const base = Math.trunc(total / partes);
  const resto = total - base * partes;
  return Array.from({ length: partes }, (_, i) => centavos(i === 0 ? base + resto : base));
}
