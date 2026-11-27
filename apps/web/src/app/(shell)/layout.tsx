import type { ReactNode } from 'react';
import { Casca } from './casca';

export default function LayoutShell({ children }: { children: ReactNode }) {
  return <Casca>{children}</Casca>;
}
