/**
 * Tokens da marca Macuxi (manual da marca do FDV, §3 cores, §5 tipografia). Cor nova só pelo design-de-marca.
 * Cada token vira a variável CSS `--mx-*` em `tokens.css` (o teste garante a paridade).
 */
export const cores = {
  azulNoite: '#1E3350',
  perola: '#F8F6F1',
  branco: '#FFFFFF',
  /** Sol laranja: ação principal e destaque (§3). */
  solLaranja: '#C2540A',
  /** Sol claro: só sobre fundo escuro (Azul noite, Grafite); nunca como texto em fundo claro (§3). */
  solClaro: '#F59A52',
  grafite: '#16202A',
  grafiteMenu: '#2B3743',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  azulClaro: '#9AA3B0',
  bordaCinza: '#C9CED5',
  bordaTabela: '#DFE2E6',
  ativoFundo: '#E2F1EA',
  ativoTexto: '#1D6B4F',
  inativoFundo: '#ECEEF1',
  erroTexto: '#A8261B',
  erroFundo: '#FDE8E6',
} as const;

export const fontes = {
  /** Pilha do §5.1. */
  base: "'Inter', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

/** Escala do §5.3, em px. */
export const tipografia = {
  base: 15,
  tituloCartao: 24,
  h1: 24,
  tituloGrupo: 12,
  selo: 12,
} as const;

export const pesos = {
  normal: 400,
  cabecalhoTabela: 600,
  titulo: 700,
} as const;

export type Cor = keyof typeof cores;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Mapa `--mx-*` -> valor, a partir dos tokens acima. */
export function variaveisCss(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, x] of Object.entries(cores)) v[`--mx-cor-${kebab(k)}`] = x;
  v['--mx-fonte-base'] = fontes.base;
  for (const [k, x] of Object.entries(tipografia)) v[`--mx-tamanho-${kebab(k)}`] = `${x}px`;
  for (const [k, x] of Object.entries(pesos)) v[`--mx-peso-${kebab(k)}`] = String(x);
  return v;
}
