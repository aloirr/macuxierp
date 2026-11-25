import type { ReactNode } from 'react';
import { seloBase, tons } from './estilos.js';

export interface ChipProps {
  tom: 'sucesso' | 'aviso' | 'erro' | 'neutro';
  children: ReactNode;
}

/** Selo de situação, mesmo formato do `.selo` do shell. Laranja do sol não é cor de estado. O tom erro (vermelho) é para falha que pede ação; o texto do chip diz a situação, a cor nunca é a única pista. */
export function Chip({ tom, children }: ChipProps) {
  return (
    <span style={{ ...seloBase, ...tons[tom] }}>
      {children}
    </span>
  );
}
