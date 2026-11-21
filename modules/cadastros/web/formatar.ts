/** Formatação de exibição do BKO. O dado trafega sempre em centavos e × 10^4 (D11); só a tela converte. */

export function formatarDocumento(doc: string): string {
  if (/^\d{11}$/.test(doc)) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (/^[0-9A-Z]{12}\d{2}$/.test(doc)) return doc.replace(/^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return doc;
}

const milhar = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function formatarCentavos(c: number): string {
  const neg = c < 0;
  const abs = BigInt(Math.abs(c));
  return `${neg ? '-' : ''}R$ ${milhar(abs / 100n)},${String(abs % 100n).padStart(2, '0')}`;
}

/** "1.234,56" → 123456. Duas casas no máximo; `null` se não for número. */
export function interpretarCentavos(texto: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  return Number((m[1] as string).replaceAll('.', '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatarQuantidade(q: number): string {
  const neg = q < 0;
  const abs = BigInt(Math.abs(q));
  const frac = String(abs % 10_000n).padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${milhar(abs / 10_000n)}${frac ? `,${frac}` : ''}`;
}

/** "12,5" → 125000 (até 4 casas). */
export function interpretarQuantidade(texto: string): number | null {
  const m = /^(-?)(\d+)(?:,(\d{1,4}))?$/.exec(texto.trim());
  if (!m) return null;
  const v = Number(m[2]) * 10_000 + Number((m[3] ?? '').padEnd(4, '0'));
  return m[1] ? -v : v;
}
