/**
 * Formatação de exibição do BKO do pedido. O dado trafega em centavos e em Qtd4 (× 10^4); só a tela converte.
 * PONTE até a RD-0362 (formatar no SDK, recado ao engenheiro-software): `formatarCentavos` e `formatarQuantidade` repetem os de
 * `modules/cadastros/web/formatar.ts`, porque um módulo não importa o `web` de outro (fronteiras). A troca é só o `import`.
 */

const milhar = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function formatarCentavos(c: number): string {
  const abs = BigInt(Math.abs(c));
  return `${c < 0 ? '-' : ''}R$ ${milhar(abs / 100n)},${String(abs % 100n).padStart(2, '0')}`;
}

/** "1.234,56" → 123456. Duas casas no máximo; `null` se não for número. */
export function interpretarCentavos(texto: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  return Number((m[1] as string).replaceAll('.', '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatarQuantidade(q: number): string {
  const abs = BigInt(Math.abs(q));
  const frac = String(abs % 10_000n).padStart(4, '0').replace(/0+$/, '');
  return `${q < 0 ? '-' : ''}${milhar(abs / 10_000n)}${frac ? `,${frac}` : ''}`;
}

/** "12,5" → 125000 (até 4 casas). Sem sinal: quantidade de pedido é sempre positiva. */
export function interpretarQuantidade(texto: string): number | null {
  const m = /^(\d+)(?:,(\d{1,4}))?$/.exec(texto.trim());
  return m ? Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0')) : null;
}

/** Pontos-base (1 bp = 0,01%): `1250` → `12,5%`. */
export function formatarPontosBase(bp: number): string {
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return `${Math.trunc(bp / 100)}${frac ? `,${frac}` : ''}%`;
}

/** Instante UTC (ISO 8601) no fuso do tenant (`eu.empresa.fuso`), em português: `21/11/2026 19:05`. */
export function formatarDataHora(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(d)
    .replace(', ', ' ');
}

/** Inverso de `interpretarCentavos`, para preencher o campo: `123456` → `1.234,56` (sem o R$). */
export const textoCentavos = (c: number): string => formatarCentavos(c).replace('R$ ', '');

/** Inverso de `interpretarQuantidade`, sem separador de milhar: `125000` → `12,5`. */
export function textoQuantidade(q: number): string {
  const frac = String(q % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${Math.trunc(q / 10_000)}${frac ? `,${frac}` : ''}`;
}
