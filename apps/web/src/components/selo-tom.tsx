import type { ReactNode } from 'react';
import { Chip } from '@macuxierp/ui';
import type { Tom } from '@/lib/config/operacao-fdv';

/**
 * Selo de situação da operação da Integração FDV. O `Chip` da ui ainda não tem o tom `erro` (packages/ui é do designer-ux): até lá o erro usa
 * o `.selo-erro` do shell, com o mesmo formato. O estado nunca vai só por cor: o texto vai junto.
 */
export function SeloTom({ tom, children }: { tom: Tom; children: ReactNode }) {
  return tom === 'erro' ? <span className="selo selo-erro">{children}</span> : <Chip tom={tom}>{children}</Chip>;
}
