import type { CSSProperties } from 'react';
import type { Cor } from './tokens.js';

/** Cor do token da marca como `var()`; nunca literal (T-0028). */
export const cor = (nome: Cor | 'ativoTexto' | 'inativoFundo' | 'linhaSuave'): string =>
  `var(--mx-cor-${nome.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

/** Espaçamentos em múltiplos de 4px (a marca ainda não tem tokens de espaço; ver RD no doc de design). */
export const espaco = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export type TamanhoTexto = 'micro' | 'pequeno' | 'base' | 'medio' | 'grande' | 'titulo' | 'titulo-cartao' | 'titulo-dialogo' | 'h1' | 'titulo-grupo' | 'selo';
export type PesoTexto = 'normal' | 'medio' | 'cabecalho-tabela' | 'rotulo-campo' | 'botao-principal' | 'numero-card' | 'aba-ativa' | 'rotulo-pequeno' | 'titulo';

export const texto = (tamanho: TamanhoTexto, peso?: PesoTexto): CSSProperties => ({
  fontFamily: 'var(--mx-fonte-texto)',
  fontSize: `var(--mx-tamanho-${tamanho})`,
  fontWeight: peso ? `var(--mx-peso-${peso})` : undefined,
  color: cor('grafite'),
});

export const numerico: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/** Estado desabilitado único (MC-0014): esmaecido e sem cursor de ação. */
export const desabilitadoEstilo = (desabilitado?: boolean): CSSProperties =>
  desabilitado ? { opacity: 0.55, cursor: 'not-allowed' } : { cursor: 'pointer' };

/** Estilo único das duas tabelas (MC-0013). */
export const tabela = {
  raiz: { ...texto('pequeno'), width: '100%', borderCollapse: 'collapse', background: cor('branco') } as CSSProperties,
  cabecalho: { ...texto('pequeno', 'cabecalho-tabela'), textAlign: 'left', padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, background: cor('nevoa') } as CSSProperties,
  celula: { padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, verticalAlign: 'top' } as CSSProperties,
  vazio: { textAlign: 'center', color: cor('textoSecundario'), padding: espaco.xl } as CSSProperties,
};
