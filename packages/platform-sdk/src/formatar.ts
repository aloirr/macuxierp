/**
 * Formatação de exibição do BKO (RD-0362), num lugar só para os módulos e o shell. Sem dependência de Node e sem
 * import: o shell (`apps/web`) usa por `@macuxierp/platform-sdk/formatar` (ou pelo índice do pacote).
 * O dado trafega sempre em centavos (regra 4, `./dinheiro`) e a quantidade × 10^4 (D11); só a tela converte, em BigInt,
 * sem float; a data entra em UTC e sai no fuso do tenant (Intl). Veio de `modules/cadastros/web/formatar.ts` e de
 * `modules/pedido/web/formatar.ts`.
 */

/** CPF (11 dígitos) e CNPJ (14, também o alfanumérico) com máscara; o resto volta como está. Só exibe, não valida. */
export function formatarDocumento(doc: string): string {
  if (/^\d{11}$/.test(doc)) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (/^[0-9A-Z]{12}\d{2}$/.test(doc)) return doc.replace(/^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return doc;
}

const milhar = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * O valor sem o prefixo (RD-0706), para campo de entrada e coluna que já diz "R$": 123456 → "1.234,56";
 * -250 → "-2,50". RangeError se não for inteiro (centavo nunca é float).
 */
export function formatarValorCentavos(c: number): string {
  const abs = BigInt(Math.abs(c));
  return `${c < 0 ? '-' : ''}${milhar(abs / 100n)},${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * 123456 → "R$ 1.234,56"; -250 → "-R$ 2,50" (o sinal antes do "R$"). Entre o "R$" e o valor vai um espaço não
 * separável (U+00A0), para o R$ não quebrar de linha. Monta sobre `formatarValorCentavos` (mesma conta e RangeError).
 */
export function formatarCentavos(c: number): string {
  const valor = formatarValorCentavos(c);
  return c < 0 ? `-R$\u00a0${valor.slice(1)}` : `R$\u00a0${valor}`;
}

/** "1.234,56" → 123456. Duas casas no máximo; `null` se não for número. */
export function interpretarCentavos(texto: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  return Number((m[1] as string).replaceAll('.', '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Quantidade × 10^4 → decimal sem zeros à direita: 125000 → "12,5". */
export function formatarQuantidade(q: number): string {
  const neg = q < 0;
  const abs = BigInt(Math.abs(q));
  const frac = String(abs % 10_000n).padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${milhar(abs / 10_000n)}${frac ? `,${frac}` : ''}`;
}

/** "12,5" → 125000 (até 4 casas); `null` se não for número. */
export function interpretarQuantidade(texto: string): number | null {
  const m = /^(-?)(\d+)(?:,(\d{1,4}))?$/.exec(texto.trim());
  if (!m) return null;
  const v = Number(m[2]) * 10_000 + Number((m[3] ?? '').padEnd(4, '0'));
  return m[1] ? -v : v;
}

/** Pontos-base (1 bp = 0,01%): 1250 → "12,5%"; 500 → "5%"; −50 → "-0,5%". */
export function formatarPontosBase(bp: number): string {
  const abs = Math.abs(bp);
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '');
  return `${bp < 0 ? '-' : ''}${Math.trunc(abs / 100)}${frac ? `,${frac}` : ''}%`;
}

/**
 * Instante UTC (ISO 8601, como vem do banco e da API) no fuso do tenant, em português: "21/11/2026 19:05".
 * O fuso (IANA, ex.: `eu.empresa.fuso`) é sempre parâmetro, nunca fixo (regra 4). ISO inválido volta como está.
 */
export function formatarDataHora(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(d)
    .replace(', ', ' ');
}
