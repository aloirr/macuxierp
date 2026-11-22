import { formatarValorCentavos, interpretarCentavos } from '@macuxierp/platform-sdk/formatar';

// Campo de dinheiro sobre o sdk (RD-0723): vazio = 0, aceita "R$ ", sem negativo; o resto é `interpretarCentavos`/`formatarValorCentavos`.

/** "1.234,56" ou "1234,5" (reais) para centavos inteiros; null se inválido. Vazio = 0. */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, '');
  if (t === '') return 0;
  const c = interpretarCentavos(t);
  return c !== null && Number.isSafeInteger(c) ? c : null;
}

/** Centavos inteiros para o texto do campo "1.234,56" (com milhar, como no shell); negativo, NaN e Infinity viram 0. */
export function centavosParaReais(centavos: number): string {
  if (!Number.isFinite(centavos)) return '0,00';
  return formatarValorCentavos(Math.max(0, Math.trunc(centavos)));
}

/** "1,5" ou "1.5" para número com até 4 casas; null se inválido. Vazio = 0. */
export function textoParaQuantidade(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return 0;
  if (!/^\d+(?:[.,]\d{1,4})?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}
