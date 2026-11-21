/**
 * Exportar CSV das tabelas do BKO (RF-CORE-02 e 05). Padrão do Excel em pt-BR: separador `;`, BOM UTF-8 e CRLF.
 * Células que começam com `= + - @` ganham um apóstrofo (injeção de fórmula em planilha).
 */
export interface ColunaCsv<L> {
  titulo: string;
  valor(linha: L): string | number | boolean | null | undefined;
}

const SEPARADOR = ';';
const BOM = String.fromCharCode(0xfeff);

function celula(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paraCsv<L>(colunas: readonly ColunaCsv<L>[], linhas: readonly L[]): string {
  const cab = colunas.map((c) => celula(c.titulo)).join(SEPARADOR);
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(SEPARADOR));
  return `${BOM}${[cab, ...corpo].join('\r\n')}\r\n`;
}
