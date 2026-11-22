import { NOME_PRODUTO } from '@/lib/marca';
import '@macuxierp/ui/tokens.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: { default: NOME_PRODUTO, template: `%s · ${NOME_PRODUTO}` }, robots: { index: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
