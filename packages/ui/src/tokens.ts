/**
 * Tokens da marca Macuxi (manual da marca do FDV: §3 cores, §5 tipografia). Cor nova só pelo design-de-marca.
 * Cada token vira a variável CSS `--mx-*` em `tokens.css` (o teste garante a paridade).
 * Valor repetido não ganha segundo literal: vira alias em `aliasCores` (a variável CSS aponta com `var()`).
 */
export const cores = {
  /** Texto de título, faixa do cabeçalho e barra superior; botão principal, link e aba ativa. O menu lateral do BKO é grafite (§4). */
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
  /** Só sobre fundo escuro. Como texto vale apenas no título de grupo do menu do BKO e do painel, e na frase do Início. */
  solClaro: '#F59A52',
  grafite: '#16202A',
  /** Só a tela atual, o hover e a divisória do menu lateral do BKO. NÃO é o fundo do menu. */
  grafiteMenu: '#2B3743',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  /** Linha suave, chip neutro e fundo de mapa. */
  nevoa: '#ECEEF1',
  /** Linha forte, borda do mapa, caixas do PDF e texto claro na faixa. A borda do cartão é `bordaTabela`; a de campo e botão secundário é `bordaCampo`. */
  bordaCinza: '#C9CED5',
  /** Borda de campo, caixa de texto e botão secundário (contraste de componente, decisão #232). */
  bordaCampo: '#7A8593',
  /** Borda do cartão, chip, cartão em destaque e linha (inclui borda de tabela). */
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
  /** Zebra das tabelas: fundo das linhas pares (decisão 44 A do Alexandre, 27/11; docs/design/config-menos-e-mais). */
  linhaAlternada: '#FBFAF8',
} as const;

export type Cor = keyof typeof cores;

/** Mesmo valor, outro papel: alias para uma cor de `cores`. */
export const aliasCores = {
  ativoTexto: 'verdeSucesso',
  inativoFundo: 'nevoa',
  linhaSuave: 'nevoa',
  graficoSerieCinza: 'textoSecundario',
  /** Rótulo de dado, cabeçalho de tabela e título de bloco (regra das telas horizontais, R-20261127-110345; docs/design/telas-horizontais.md). */
  rotuloDestaque: 'azulNoite',
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

/** Papel -> degrau da escala. Valores e formas em docs/design/telas-horizontais.md §2 (decisões 40 e 45). */
export const papeis = {
  tituloCartao: 'pequeno',
  tituloDialogo: 'grande',
  h1: 'grande',
  /** Texto de campo, valor e célula de tabela. */
  texto: 'pequeno',
  /** Só o rótulo de grupo do menu lateral (caixa alta). Título usa tituloCartao/tituloDialogo ou h1. */
  rotuloMenu: 'micro',
  /** @deprecated Use rotuloMenu. Alias por uma versão (sai depois que o shell trocar `--mx-tamanho-titulo-grupo` em globals.css). */
  tituloGrupo: 'micro',
  selo: 'micro',
  /** Rótulo de dado (dt, rótulo de campo só leitura): caixa-alta pequena, com `pesos.rotuloDado` e `rotuloDestaque`. Também o rótulo de campo e o th. O valor usa `texto`. */
  rotuloDado: 'micro',
} as const satisfies Record<string, keyof typeof escala>;

/** §5.2: 400, 500, 600 e 700 por papel. Nada em 800/900. */
export const pesos = {
  normal: 400,
  /** Item de menu, chip e botão secundário. */
  medio: 500,
  /** th: 700, caixa-alta, azul-noite, com linha de 2 px (decisão 40). */
  cabecalhoTabela: 700,
  rotuloCampo: 600,
  botaoPrincipal: 600,
  numeroCard: 600,
  abaAtiva: 600,
  rotuloPequeno: 600,
  /** Rótulo de dado (caixa-alta pequena, `rotuloDestaque`): visivelmente diferente do valor (400). */
  rotuloDado: 600,
  titulo: 700,
} as const;

/** Grade de blocos, em px: largura mínima de um cartão (quebras 390/768/1280/1440, colunas e vão de 16 px só em docs/design/telas-horizontais.md: media query não lê token). */
export const grade = {
  cartaoMinimo: 280,
} as const;

/** Medidas únicas, em px (regra 11 do CLAUDE.md, "menos é mais"): iguais em todas as telas. */
export const medidas = {
  /** Campo, select, todo botão e o th. */
  alturaCampo: 34,
  alturaLinhaTabela: 36,
  /** Cartão e diálogo. O espaço de 12 px é `espaco.md` (estilos.ts). */
  cantoCartao: 8,
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
  for (const [k, x] of Object.entries(grade)) v[`--mx-grade-${kebab(k)}`] = `${x}px`;
  for (const [k, x] of Object.entries(medidas)) v[`--mx-medida-${kebab(k)}`] = `${x}px`;
  return v;
}

/** Conteúdo de `tokens.css`. */
export function gerarCss(): string {
  const linhas = Object.entries(variaveisCss()).map(([k, x]) => `  ${k}: ${x};`);
  return `/* Gerado de tokens.ts (gerarCss). Não edite à mão: o teste exige igualdade. */\n:root {\n${linhas.join('\n')}\n}\n`;
}
