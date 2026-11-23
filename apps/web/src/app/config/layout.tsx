import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Todo `<title>` do portal leva "Plataforma" (spec do portal). */
export const metadata: Metadata = { title: { default: 'Plataforma', template: '%s · Plataforma' } };

export default function ConfigLayout({ children }: { children: ReactNode }) {
  return children;
}
