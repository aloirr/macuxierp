import { describe, expect, it } from 'vitest';
import config, { REGRA_SEM_CACHE } from '../../next.config';

/** O Next compila `source` com path-to-regexp; aqui só confere a intenção com o mesmo grupo de negative lookahead. */
describe('headers() do next.config: HTML sem cache', () => {
  it('a regra no-store existe e a de segurança continua em /:path*', async () => {
    const regras = await config.headers!();
    const semCache = regras.find((r) => r.source === REGRA_SEM_CACHE);
    expect(semCache?.headers).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);
    expect(regras.find((r) => r.source === '/:path*')?.headers.map((h) => h.key)).toContain('X-Content-Type-Options');
  });
  it('páginas entram; estáticos, imagens, favicon e arquivos de public/ ficam de fora', () => {
    const re = new RegExp(`^${REGRA_SEM_CACHE.replace(/^\/\(/, '/(')}$`);
    for (const ok of ['/', '/login', '/config/entrar', '/pedido/lista', '/esqueci']) expect(re.test(ok), ok).toBe(true);
    for (const fora of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/marca/logo.svg', '/robots.txt']) expect(re.test(fora), fora).toBe(false);
  });
});
