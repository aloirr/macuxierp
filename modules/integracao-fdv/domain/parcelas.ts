/**
 * Prazo de pagamento no contrato do Hub (`PrazoPagamentoPayload.parcelas_dias`): lista de inteiros, na ordem das
 * parcelas; à vista = `[0]` (T-0085). Antes de T-0085 o espelho guardava o texto `"28/56"`; o leitor aceita os dois.
 */

export function parcelasDiasParaHub(prazosDias: readonly number[]): number[] {
  return prazosDias.length === 0 ? [0] : [...prazosDias];
}

export function lerParcelasDias(valor: unknown): number[] | null {
  let lista: unknown[];
  if (Array.isArray(valor)) lista = valor;
  else if (typeof valor === 'string' && /^\d{1,3}(\/\d{1,3})*$/.test(valor)) lista = valor.split('/').map(Number);
  else return null;
  if (lista.length === 0 || !lista.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null;
  return lista as number[];
}
