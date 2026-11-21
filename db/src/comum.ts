import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Trava consultiva das migrações e da carga oficial (duas publicações ao mesmo tempo esperam uma pela outra). */
export const TRAVA_MIGRACAO = 7_302_003;

export function sha256Arquivo(caminho: string): string {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex');
}
