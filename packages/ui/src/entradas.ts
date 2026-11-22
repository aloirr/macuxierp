/** Conversões de campos digitados, sem ponto flutuante na entrada de dinheiro. */

/** "1.234,56" ou "1234,5" (reais) para centavos inteiros; null se inválido. Vazio = 0. */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, '');
  if (t === '') return 0;
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const reais = Number((m[1] ?? '0').replace(/\./g, ''));
  const cent = Number(((m[2] ?? '') + '00').slice(0, 2));
  const total = reais * 100 + cent;
  return Number.isSafeInteger(total) ? total : null;
}

/** Centavos inteiros para texto de edição "1234,56" (sem milhar). */
export function centavosParaReais(centavos: number): string {
  const c = Math.max(0, Math.trunc(centavos));
  return `${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}`;
}

/** "1,5" ou "1.5" para número com até 4 casas; null se inválido. Vazio = 0. */
export function textoParaQuantidade(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return 0;
  if (!/^\d+(?:[.,]\d{1,4})?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}
