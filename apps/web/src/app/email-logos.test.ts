import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * T-0111: os logos do e-mail de redefinição de senha são servidos como estáticos em /email/<arquivo>.png,
 * sem login (o Next serve `public/` antes de qualquer rota e o shell não tem middleware nem rewrite).
 */
const LOGOS = ['logo-macuxi-erp-positivo.png', 'logo-macuxi-erp-negativo-azul-noite.png'];
const PUBLIC_EMAIL = new URL('../../public/email/', import.meta.url);
const FONTE = new URL('../../../../docs/design/emails/redefinir-senha/', import.meta.url);
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('logos do e-mail em /email/', () => {
  it.each(LOGOS)('%s existe em public/email, é PNG e idêntico ao do design', (nome) => {
    const arquivo = new URL(nome, PUBLIC_EMAIL);
    expect(existsSync(arquivo)).toBe(true);
    const bytes = readFileSync(arquivo);
    expect(bytes.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(bytes)).toBe(sha(readFileSync(new URL(nome, FONTE))));
  });

  it('nenhum middleware intercepta /email/ nem há rewrite/redirect no next.config', () => {
    const src = new URL('../', import.meta.url);
    expect(existsSync(new URL('middleware.ts', src))).toBe(false);
    expect(existsSync(new URL('proxy.ts', src))).toBe(false);
    const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
    expect(config).not.toMatch(/\b(rewrites|redirects|basePath)\b/);
  });
});
