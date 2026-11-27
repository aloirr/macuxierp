import { AvisoVersaoNova } from '@/components/aviso-versao-nova';
import { NOME_PRODUTO } from '@/lib/marca';
import '@macuxierp/ui/tokens.css';
import '@macuxierp/ui/botoes.css';
import { appleTouchIconDataUri, faviconDataUri } from '@macuxierp/ui/marca';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: { default: NOME_PRODUTO, template: `%s · ${NOME_PRODUTO}` }, robots: { index: false }, icons: { icon: faviconDataUri, apple: [{ url: appleTouchIconDataUri, sizes: '180x180' }] } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}<AvisoVersaoNova /></body>
    </html>
  );
}
