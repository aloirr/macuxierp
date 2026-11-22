/**
 * Borda de texto dos valores do XML da NF-e (regra inegociável 4). Dentro do ERP todo dinheiro anda em centavos
 * inteiros; a conversão para texto decimal acontece SÓ aqui, sem ponto flutuante (BigInt do começo ao fim).
 * O arredondamento é o do platform-sdk (`dividirArredondando`, RN-CORE-03; o modo de cada tributo está no adendo da
 * ADR 0002 e no cabeçalho de `dinheiro.ts`).
 */
import { dividirArredondando, type ModoArredondamento } from '@macuxierp/platform-sdk';

/** Converte um decimal em texto ("12.5", "0.0001") para inteiro na escala `casas`. Recusa casas a mais. */
export function decimalParaEscala(texto: string, casas: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) throw new RangeError(`decimal inválido: ${texto}`);
  const frac = m[3] ?? '';
  if (frac.length > casas) throw new RangeError(`decimal com mais de ${casas} casas: ${texto}`);
  const inteiro = BigInt((m[2] ?? '0') + frac.padEnd(casas, '0'));
  return m[1] === '-' ? -inteiro : inteiro;
}

/** Formata um inteiro na escala `casas` como texto do leiaute ("1234" com 2 casas = "12.34"). */
export function formatarEscala(valor: bigint | number, casas: number): string {
  const v = BigInt(valor);
  const negativo = v < 0n;
  const abs = (negativo ? -v : v).toString().padStart(casas + 1, '0');
  const texto = casas === 0 ? abs : `${abs.slice(0, -casas)}.${abs.slice(-casas)}`;
  return negativo ? `-${texto}` : texto;
}

/** Centavos (inteiro) para o tipo TDec_1302 do leiaute: sempre 2 casas ("0.00", "1234.50"). */
export function centavosParaXml(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError(`centavos: ${centavos} não é inteiro seguro`);
  if (centavos < 0) throw new RangeError('valor negativo não existe no leiaute da NF-e');
  return formatarEscala(centavos, 2);
}

/** Valor em centavos de `quantidade × valorUnitario` (vProd = qCom × vUnCom), arredondado na 2ª casa. */
export function multiplicarParaCentavos(
  quantidade: string,
  valorUnitario: string,
  modo: ModoArredondamento = 'meio-para-cima',
): number {
  const q = decimalParaEscala(quantidade, 4); // 10^-4
  const u = decimalParaEscala(valorUnitario, 10); // 10^-10
  // q × u está em 10^-14; centavos = 10^-2 → divide por 10^12.
  return Number(dividirArredondando(q * u, 10n ** 12n, modo));
}

/** Tributo em centavos: base (centavos) × alíquota (% com até 4 casas), arredondado na 2ª casa. */
export function aplicarAliquotaCentavos(base: number, aliquotaPct: string, modo: ModoArredondamento): number {
  const a = decimalParaEscala(aliquotaPct, 4); // % × 10^4
  return Number(dividirArredondando(BigInt(base) * a, 100n * 10_000n, modo));
}
