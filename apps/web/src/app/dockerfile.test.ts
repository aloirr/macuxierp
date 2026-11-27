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
  const estagioBuild = DOCKERFILE.slice(DOCKERFILE.indexOf('AS build'), DOCKERFILE.lastIndexOf('\nFROM '));
  const runBuild = estagioBuild.slice(estagioBuild.indexOf('RUN --mount=type=secret'));
  it('v0.3.27: o next build lê a chave das actions de um secret do BuildKit opcional', () => {
    expect(runBuild).toMatch(/--mount=type=secret,id=next_actions_key,required=false/);
    expect(runBuild).toMatch(/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="\$\(cat \/run\/secrets\/next_actions_key 2>\/dev\/null\)"/);
    expect(runBuild).toMatch(/next build/);
  });
  it('v0.3.27: a chave nunca é ARG nem ENV (nem no runtime)', () => {
    const linhas = DOCKERFILE.split('\n').filter((l) => /^\s*(ARG|ENV)\b/.test(l) || /^\s+\S+=/.test(l) && /^(ARG|ENV)/.test(l));
    expect(linhas.join('\n')).not.toMatch(/ENCRYPTION_KEY|next_actions_key/);
    expect(DOCKERFILE).not.toMatch(/^\s*(ARG|ENV)[^\n]*(\\\n[^\n]*)*ENCRYPTION_KEY/m);
    expect(estagioFinal).not.toMatch(/ENCRYPTION_KEY/);
  });
  it('v0.3.27: MACUXI_BUILD_ID vira NEXT_PUBLIC_BUILD_ID no build, com "dev" por padrão', () => {
    expect(estagioBuild).toMatch(/^ARG MACUXI_BUILD_ID$/m);
    expect(runBuild).toMatch(/NEXT_PUBLIC_BUILD_ID="\$\{MACUXI_BUILD_ID:-dev\}"/);
  });
});
