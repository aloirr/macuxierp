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

/** Prefixo do real: "R$" e um espaço não separável (U+00A0), para o R$ não quebrar de linha (R-20261122-035009). */
export const PREFIXO_REAL = 'R$\u00a0';

/**
 * 123456 → "R$ 1.234,56"; -250 → "-R$ 2,50" (o sinal antes do "R$", que é o `PREFIXO_REAL`). Monta sobre
 * `formatarValorCentavos` (mesma conta e RangeError).
 */
export function formatarCentavos(c: number): string {
  const valor = formatarValorCentavos(c);
  return c < 0 ? `-${PREFIXO_REAL}${valor.slice(1)}` : `${PREFIXO_REAL}${valor}`;
}

/**
 * Decimal em texto, como vem no XML da NF-e (`vProd`, `vNF`, `vUnCom`: ponto decimal, sem milhar), em reais com `casas`
 * casas para o DANFE (RD-0735): ("1234.5", 2) → "R$ 1.234,50"; ("-2.5", 2) → "-R$ 2,50". Conta em texto e BigInt, sem
 * float. Não arredonda: dígito diferente de zero além de `casas` é RangeError (quem escolhe as casas é o DANFE); zero à
 * direita é aceito. RangeError também para texto fora de `-?\d+(\.\d+)?` e `casas` que não seja inteiro de 0 a 10.
 */
export function formatarReaisDecimal(decimalTexto: string, casas: number): string {
  if (!Number.isInteger(casas) || casas < 0 || casas > 10) throw new RangeError(`casas inválidas: ${casas}`);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimalTexto);
  if (!m) throw new RangeError('decimal fora do formato do XML da NF-e');
  const fracao = m[3] ?? '';
  if (/[1-9]/.test(fracao.slice(casas))) throw new RangeError(`decimal com mais de ${casas} casas`);
  const inteiro = BigInt(m[2] as string);
  const casasTexto = fracao.slice(0, casas).padEnd(casas, '0');
  const negativo = m[1] === '-' && (inteiro !== 0n || /[1-9]/.test(casasTexto));
  return `${negativo ? '-' : ''}${PREFIXO_REAL}${milhar(inteiro)}${casas > 0 ? `,${casasTexto}` : ''}`;
}

/** Parte inteira pt-BR: com o ponto de milhar só em grupos de 3 dígitos ("1.500") ou sem ponto ("1500"). */
const INTEIRO_MILHAR = String.raw`\d{1,3}(?:\.\d{3})+|\d+`;

/** Parte inteira casada por `INTEIRO_MILHAR`, sem o ponto de milhar, em número. */
const inteiroSemMilhar = (t: string) => Number(t.replaceAll('.', ''));

const RE_CENTAVOS = new RegExp(String.raw`^(${INTEIRO_MILHAR})(?:,(\d{1,2}))?$`);
const RE_QUANTIDADE = new RegExp(String.raw`^(-?)(${INTEIRO_MILHAR})(?:,(\d{1,4}))?$`);

/** "1.234,56" → 123456. Duas casas no máximo; `null` se não for número. */
export function interpretarCentavos(texto: string): number | null {
  const m = RE_CENTAVOS.exec(texto.trim());
  if (!m) return null;
  return inteiroSemMilhar(m[1] as string) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Escala do `Qtd4` (D11): quantidade × 10^4, inteira. Fonte única (RD-1831). */
export const ESCALA_QTD4 = 10_000;

/** A quantidade em `Qtd4` não tem casas decimais (é múltipla de `ESCALA_QTD4`)? Valor não inteiro ou infinito = `false`. */
export function qtd4Inteira(q: number): boolean {
  return Number.isInteger(q) && q % ESCALA_QTD4 === 0;
}

/** Quantidade × 10^4 → decimal sem zeros à direita: 125000 → "12,5". */
export function formatarQuantidade(q: number): string {
  const neg = q < 0;
  const abs = BigInt(Math.abs(q));
  const escala = BigInt(ESCALA_QTD4);
  const frac = String(abs % escala).padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${milhar(abs / escala)}${frac ? `,${frac}` : ''}`;
}

/**
 * "12,5" → 125000 (até 4 casas); "1.500,25" → 15002500: o ponto é o milhar pt-BR, só em grupos de 3 dígitos
 * (R-20261122-055654; "1.5" e "1.50" são recusados). `null` se não for número.
 */
export function interpretarQuantidade(texto: string): number | null {
  const m = RE_QUANTIDADE.exec(texto.trim());
  if (!m) return null;
  const v = inteiroSemMilhar(m[2] as string) * ESCALA_QTD4 + Number((m[3] ?? '').padEnd(4, '0'));
  return m[1] ? -v : v;
}

/** Pontos-base (1 bp = 0,01%): 1250 → "12,5%"; 500 → "5%"; −50 → "-0,5%". */
export function formatarPontosBase(bp: number): string {
  const abs = Math.abs(bp);
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '');
  return `${bp < 0 ? '-' : ''}${Math.trunc(abs / 100)}${frac ? `,${frac}` : ''}%`;
}

/** Data civil "AAAA-MM-DD" (sem fuso: vencimento, abertura) → "DD/MM/AAAA". Fora do formato volta como está. */
export function formatarDataCivil(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d;
}

/** CEP de 8 dígitos → "69000-000". Fora do formato volta como está. */
export function formatarCep(c: string): string {
  return /^\d{8}$/.test(c) ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
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
