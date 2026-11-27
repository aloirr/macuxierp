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

/**
 * T-0112: o espelho anterior à T-0085 guarda `parcelas_dias` como texto ("28/56"). No envio, o payload do prazo sai com a lista
 * de inteiros, quando legível; ilegível fica como está (e segue `campo_invalido`). Não mexe no hash do espelho.
 */
export function normalizarParcelasDias<P extends Record<string, unknown>>(payload: P): P {
  const lista = lerParcelasDias(payload.parcelas_dias);
  return lista ? { ...payload, parcelas_dias: lista } : payload;
}

/** T-0112: só o prazo é normalizado; o `hash` do espelho fica (o aceite confirma o hash da montagem, sem laço). */
export function normalizarPrazo<R extends { entidade: string; payload: Record<string, unknown> }>(r: R): R {
  return r.entidade === 'prazo_pagamento' ? { ...r, payload: normalizarParcelasDias(r.payload) } : r;
}
