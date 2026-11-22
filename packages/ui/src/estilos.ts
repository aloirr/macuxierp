import type { CSSProperties } from 'react';
import type { Cor, escala, papeis, pesos } from './tokens.js';

/** Cor do token da marca como `var()`; nunca literal (T-0028). */
export const cor = (nome: Cor | 'ativoTexto' | 'inativoFundo' | 'linhaSuave'): string =>
  `var(--mx-cor-${nome.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

/** Espaçamentos em múltiplos de 4px (a marca ainda não tem tokens de espaço; ver RD no doc de design). */
export const espaco = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

type Kebab<S extends string> = S extends `${infer A}${infer R}` ? `${A extends Lowercase<A> ? A : `-${Lowercase<A>}`}${Kebab<R>}` : S;
type TamanhoTexto = Kebab<keyof typeof escala | keyof typeof papeis>;
type PesoTexto = Kebab<keyof typeof pesos>;

export const texto = (tamanho: TamanhoTexto, peso?: PesoTexto): CSSProperties => ({
  fontFamily: 'var(--mx-fonte-texto)',
  fontSize: `var(--mx-tamanho-${tamanho})`,
  fontWeight: peso ? `var(--mx-peso-${peso})` : undefined,
  color: cor('grafite'),
});

export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
export const numerico: CSSProperties = { ...tabular, textAlign: 'right' };
/** Canto dos botões e do shell. */
const canto = '6px';

/** Estado desabilitado único (MC-0014): esmaecido e sem cursor de ação. */
export const desabilitadoEstilo = (desabilitado?: boolean): CSSProperties =>
  desabilitado ? { opacity: 0.55, cursor: 'not-allowed' } : { cursor: 'pointer' };

/** Base comum dos botões (MC-0008): 15 px ("base"), canto de 6 px e o mesmo espaçamento. */
const baseBotao = (peso: Parameters<typeof texto>[1], desabilitado?: boolean): CSSProperties => ({
  ...texto('base', peso),
  padding: `${espaco.sm}px ${espaco.lg}px`,
  borderRadius: canto,
  lineHeight: 1.5,
  ...desabilitadoEstilo(desabilitado),
});

/** Botão principal (MC-0008): azul-noite, texto branco. Um por tela. */
export const botaoPrincipal = (desabilitado?: boolean): CSSProperties => ({
  ...baseBotao('botao-principal', desabilitado),
  background: cor('azulNoite'),
  color: cor('branco'),
  border: `1px solid ${cor('azulNoite')}`,
});

/** Botão secundário (MC-0008): branco, borda de campo, peso médio. */
export const botaoSecundario = (desabilitado?: boolean): CSSProperties => ({
  ...baseBotao('medio', desabilitado),
  background: cor('branco'),
  color: cor('grafite'),
  border: `1px solid ${cor('bordaCampo')}`,
});

const kebabCss = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const regraCss = (seletor: string, e: CSSProperties) =>
  `${seletor} {\n${Object.entries(e)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${kebabCss(k)}: ${String(v)};`)
    .join('\n')}\n}\n`;

/** Conteúdo de `botoes.css` (classes `.mx-botao` e `.mx-botao-secundario` para o shell), dos mesmos objetos acima. */
export function gerarCssBotoes(): string {
  return (
    '/* Gerado de estilos.ts (gerarCssBotoes). Não edite à mão: o teste exige igualdade. */\n' +
    regraCss('.mx-botao', botaoPrincipal()) +
    regraCss('.mx-botao-secundario', botaoSecundario()) +
    regraCss('.mx-botao:disabled, .mx-botao-secundario:disabled', desabilitadoEstilo(true))
  );
}

/** Mensagem de erro de campo (MC-0015). */
export const mensagemErro: CSSProperties = { ...texto('pequeno'), color: cor('erroTexto') };

/** Estilo único das duas tabelas (MC-0013). */
export const tabela = {
  raiz: { ...texto('pequeno'), width: '100%', borderCollapse: 'collapse', background: cor('branco') } as CSSProperties,
  cabecalho: { ...texto('pequeno', 'cabecalho-tabela'), textAlign: 'left', padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, background: cor('nevoa') } as CSSProperties,
  celula: { padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, verticalAlign: 'top' } as CSSProperties,
  /** Célula numérica ou de dinheiro: sem quebra de linha (o `th` continua só com `numerico`). */
  celulaNumerica: { ...numerico, whiteSpace: 'nowrap' } as CSSProperties,
  /** Legenda de tabela: pequeno, peso 600, à esquerda. */
  legenda: { ...texto('pequeno', 'rotulo-campo'), textAlign: 'left', padding: espaco.sm } as CSSProperties,
  vazio: { textAlign: 'center', color: cor('textoSecundario'), padding: espaco.xl } as CSSProperties,
};
