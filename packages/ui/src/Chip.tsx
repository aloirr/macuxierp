import type { ReactNode } from 'react';
import { seloBase, tons } from './estilos.js';

export interface ChipProps {
  tom: 'sucesso' | 'aviso' | 'neutro';
  children: ReactNode;
}

/** Selo de situação, mesmo formato do `.selo` do shell. Laranja do sol não é cor de estado. */
export function Chip({ tom, children }: ChipProps) {
  return (
    <span style={{ ...seloBase, ...tons[tom] }}>
      {children}
    </span>
  );
}
