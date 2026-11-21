import { NOME_PRODUTO } from '@/lib/marca';
import { cores } from '@macuxierp/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: { default: NOME_PRODUTO, template: `%s · ${NOME_PRODUTO}` }, robots: { index: false } };

// Tokens da marca (packages/ui) como variáveis CSS: uma única fonte das cores.
const variaveis = Object.fromEntries(Object.entries(cores).map(([k, v]) => [`--mx-${k}`, v]));

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" style={variaveis}>
      <body>{children}</body>
    </html>
  );
}
