import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * v0.3.20: a imagem do web precisa levar o `public/` (os logos do e-mail em /email/, T-0111). O standalone do Next não
 * copia o `public/`; sem o COPY, /email/logo-*.png dá 404 em produção e o Gmail mostra o "?".
 */
const DOCKERFILE = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const estagioFinal = DOCKERFILE.slice(DOCKERFILE.lastIndexOf('\nFROM '));

describe('Dockerfile do web', () => {
  it('o estágio final copia o public/ ao lado do server.js', () => {
    expect(estagioFinal).toMatch(/^COPY --from=build --chown=node:node \/app\/apps\/web\/public \.\/apps\/web\/public$/m);
  });
  it('o comentário não diz mais que não há public/', () => {
    expect(DOCKERFILE).not.toMatch(/não tem pasta public/);
  });
});
