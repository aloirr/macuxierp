import type { CSSProperties } from 'react';
import type { Cor } from './tokens.js';

/** Cor do token da marca como `var()`; nunca literal (T-0028). */
export const cor = (nome: Cor | 'ativoTexto' | 'inativoFundo' | 'linhaSuave'): string =>
  `var(--mx-cor-${nome.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

/** Espaçamentos em múltiplos de 4px (a marca ainda não tem tokens de espaço; ver RD no doc de design). */
export const espaco = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const texto = (tamanho: 'micro' | 'pequeno' | 'base' | 'grande', peso?: 'normal' | 'medio' | 'cabecalho-tabela' | 'titulo'): CSSProperties => ({
  fontFamily: 'var(--mx-fonte-texto)',
  fontSize: `var(--mx-tamanho-${tamanho})`,
  fontWeight: peso ? `var(--mx-peso-${peso})` : undefined,
  color: cor('grafite'),
});

export const numerico: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
