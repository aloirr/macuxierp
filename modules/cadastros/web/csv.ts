export interface ColunaCsv {
  chave: string;
  rotulo: string;
  formatar?: (valor: unknown) => string;
}

const BOM = String.fromCharCode(0xfeff);
const PERIGOSO = /^[=+\-@\t\r]/;

function celula(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (PERIGOSO.test(t)) t = `'${t}`; // injeção de fórmula em planilha
  return /[";\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** CSV do BKO: `;` como separador, BOM UTF-8 e CRLF, o que o Excel em português abre sem assistente. */
export function paraCsv(colunas: readonly ColunaCsv[], linhas: readonly Record<string, unknown>[]): string {
  const cab = colunas.map((c) => celula(c.rotulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.formatar ? c.formatar(l[c.chave]) : l[c.chave])).join(';'));
  return `${BOM}${[cab, ...corpo].join('\r\n')}\r\n`;
}
