/**
 * Tokens da marca Macuxi (manual da marca do FDV: §3 cores, §5 tipografia). Cor nova só pelo design-de-marca.
 * Cada token vira a variável CSS `--mx-*` em `tokens.css` (o teste garante a paridade).
 * Valor repetido não ganha segundo literal: vira alias em `aliasCores` (a variável CSS aponta com `var()`).
 */
export const cores = {
  /** Fundo escuro (menu, topo), texto de título, botão principal, link e aba ativa. */
  azulNoite: '#1E3350',
  /** Fundo geral das telas. */
  perola: '#F8F6F1',
  branco: '#FFFFFF',
  /** Azul sobre o grafite (§3): detalhe e série de gráfico em fundo escuro. */
  azulClaro: '#9AA3B0',
  /** SÓ série de gráfico. */
  azulMedio: '#5B7FA6',
  /** Sol do logo e gráficos. NÃO é cor de botão principal. */
  solLaranja: '#C2540A',
  /** Só sobre fundo escuro. Como texto vale apenas no título de grupo do menu do BKO e na frase do Início. */
  solClaro: '#F59A52',
  grafite: '#16202A',
  /** Menu lateral. */
  grafiteMenu: '#2B3743',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  /** Linha suave, chip neutro e fundo de mapa. */
  nevoa: '#ECEEF1',
  /** Borda forte (campo, cartão). */
  bordaCinza: '#C9CED5',
  /** Chip, cartão em destaque e linha (inclui borda de tabela). */
  bordaTabela: '#DFE2E6',
  /** SÓ situação (ativo, autorizada). */
  verdeSucesso: '#1D6B4F',
  /** Série "outros" no gráfico. */
  graficoOutros: '#8B96A3',
  ativoFundo: '#E2F1EA',
  erroTexto: '#A8261B',
  erroFundo: '#FDE8E6',
  /** Texto de aviso (sobre `avisoFundo`). */
  avisoTexto: '#7A4F00',
  avisoFundo: '#FFF1D6',
} as const;

export type Cor = keyof typeof cores;

/** Mesmo valor, outro papel: alias para uma cor de `cores`. */
export const aliasCores = {
  ativoTexto: 'verdeSucesso',
  inativoFundo: 'nevoa',
  linhaSuave: 'nevoa',
  graficoSerieCinza: 'textoSecundario',
} as const satisfies Record<string, Cor>;

export const fontes = {
  /** Texto (§5.1). Só fontes do sistema, sem @font-face. */
  texto: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
  /** Código (§5.1). */
  codigo: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
  /** CNPJ, CPF, números, datas e valores usam a fonte de texto com esta variante (`font-variant-numeric`). */
  numeros: 'tabular-nums',
} as const;

/** Degraus da escala web, em px (§5.3). */
export const escala = {
  micro: 12,
  pequeno: 13,
  base: 15,
  medio: 17,
  grande: 20,
  titulo: 24,
} as const;

/** Papel -> degrau da escala. Título de cartão e de diálogo em 20; só o h1 em 24. */
export const papeis = {
  tituloCartao: 'grande',
  tituloDialogo: 'grande',
  h1: 'titulo',
  tituloGrupo: 'micro',
  selo: 'micro',
} as const satisfies Record<string, keyof typeof escala>;

/** §5.2: 400, 500, 600 e 700 por papel. Nada em 800/900. */
export const pesos = {
  normal: 400,
  /** Item de menu, chip e botão secundário. */
  medio: 500,
  cabecalhoTabela: 600,
  rotuloCampo: 600,
  botaoPrincipal: 600,
  numeroCard: 600,
  titulo: 700,
} as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Variável CSS -> valor (literal ou `var()` de alias). */
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

/** Conteúdo de `tokens.css`. */
export function gerarCss(): string {
  const linhas = Object.entries(variaveisCss()).map(([k, x]) => `  ${k}: ${x};`);
  return `/* Gerado de tokens.ts (gerarCss). Não edite à mão: o teste exige igualdade. */\n:root {\n${linhas.join('\n')}\n}\n`;
}
