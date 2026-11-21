/**
 * Tokens da marca Macuxi (manual da marca do FDV: §3 cores, §5 tipografia). Cor nova só pelo design-de-marca.
 * Cada token vira a variável CSS `--mx-*` em `tokens.css` (o teste garante a paridade).
 * Valor repetido não ganha segundo literal: vira alias em `aliasCores` (a variável CSS aponta com `var()`).
 */
export const cores = {
  /** Fundo escuro (menu, topo) e texto de título. */
  azulNoite: '#1E3350',
  /** Fundo geral das telas. */
  perola: '#F8F6F1',
  branco: '#FFFFFF',
  /** Azul suave: fundo de realce (linha selecionada, aviso informativo). */
  azulSuave: '#E3EAF4',
  /** Azul serra: elemento de identidade e série de gráfico. */
  azulSerra: '#24456B',
  /** Azul claro: detalhe sobre fundo escuro e série de gráfico. */
  azulClaro: '#9DB8E0',
  /** Azul médio: SÓ série de gráfico. */
  azulMedio: '#5B7FA6',
  /** Sol laranja: sol do logo e gráficos. NÃO é cor de botão principal. */
  solLaranja: '#C2540A',
  /** Sol claro: só sobre fundo escuro (Azul noite, Grafite); nunca como texto em fundo claro. */
  solClaro: '#F59A52',
  grafite: '#16202A',
  /** Grafite do menu lateral. */
  grafiteMenu: '#2B3743',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  /** Névoa: linha suave, chip neutro e fundo de mapa. */
  nevoa: '#ECEEF1',
  /** Borda forte (campo, cartão). */
  bordaCinza: '#C9CED5',
  /** Linha e borda de tabela. */
  bordaTabela: '#DFE2E6',
  /** Verde sucesso: SÓ situação (ativo, autorizada). */
  verdeSucesso: '#1D6B4F',
  /** "Outros" no gráfico. */
  graficoOutros: '#8B96A3',
  ativoFundo: '#E2F1EA',
  erroTexto: '#A8261B',
  erroFundo: '#FDE8E6',
} as const;

export type Cor = keyof typeof cores;

/** Mesmo valor, outro papel: alias explícito para uma cor de `cores`. */
export const aliasCores = {
  ativoTexto: 'verdeSucesso',
  inativoFundo: 'nevoa',
  linhaSuave: 'nevoa',
  graficoSerieCinza: 'textoSecundario',
} as const satisfies Record<string, Cor>;

export const fontes = {
  /** §5.1: texto. Sem @font-face: só fontes do sistema. */
  texto: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
  /** §5.1: código. */
  codigo: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
  /** CNPJ, CPF, números, datas e valores usam a fonte de texto com esta variante (`font-variant-numeric`). */
  numeros: 'tabular-nums',
} as const;

/** §5.3: escala web em px. */
export const escala = {
  micro: 12,
  pequeno: 13,
  base: 15,
  medio: 17,
  grande: 20,
  titulo: 24,
} as const;

/** Papéis da escala (nome do papel -> degrau). */
export const papeis = {
  tituloCartao: 'titulo',
  h1: 'titulo',
  tituloGrupo: 'micro',
  selo: 'micro',
} as const satisfies Record<string, keyof typeof escala>;

/** §5.2: 400 normal, 600 cabeçalho de tabela, 700 título. Nada em 800/900. */
export const pesos = {
  normal: 400,
  cabecalhoTabela: 600,
  titulo: 700,
} as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Mapa `--mx-*` -> valor (literal ou `var()` de alias), a partir dos tokens acima. */
export function variaveisCss(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, x] of Object.entries(cores)) v[`--mx-cor-${kebab(k)}`] = x;
  for (const [k, x] of Object.entries(aliasCores)) v[`--mx-cor-${kebab(k)}`] = `var(--mx-cor-${kebab(x)})`;
  for (const [k, x] of Object.entries(fontes)) v[`--mx-fonte-${kebab(k)}`] = x;
  for (const [k, x] of Object.entries(escala)) v[`--mx-tamanho-${kebab(k)}`] = `${x}px`;
  for (const [k, x] of Object.entries(papeis)) v[`--mx-tamanho-${kebab(k)}`] = `var(--mx-tamanho-${x})`;
  for (const [k, x] of Object.entries(pesos)) v[`--mx-peso-${kebab(k)}`] = String(x);
  return v;
}

/** Texto de `tokens.css`. */
export function gerarCss(): string {
  const linhas = Object.entries(variaveisCss()).map(([k, x]) => `  ${k}: ${x};`);
  return `/* Gerado de tokens.ts (gerarCss). Não edite à mão: o teste exige igualdade. */\n:root {\n${linhas.join('\n')}\n}\n`;
}
