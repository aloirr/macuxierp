import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { casarRota } from './paginas';

const aqui = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

describe('a carga saiu do BKO (T-0058)', () => {
  it('não há mais a rota envio-carga, o proxy de modelo nem a tela de carga no web', () => {
    expect(existsSync(aqui('../app/envio-carga/route.ts'))).toBe(false);
    expect(existsSync(aqui('../app/baixar-modelo/route.ts'))).toBe(false);
    expect(existsSync(aqui('../app/(shell)/[modulo]/[...pagina]/carga.tsx'))).toBe(false);
  });
  it('a rota antiga da carga não resolve a nenhuma página do BKO (o item do menu sai com o manifesto do cadastros)', () => {
    expect(casarRota('/cadastros/carga-de-cadastros')).toBeUndefined();
  });
});
