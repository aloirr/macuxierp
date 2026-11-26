import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * T-0111: os logos do e-mail de redefinição de senha são servidos como estáticos em /email/<arquivo>.png,
 * sem login (o Next serve `public/` antes de qualquer rota e o shell não tem middleware nem rewrite).
 */
// sha256 dos arquivos de docs/design/emails/redefinir-senha/ em 2026-11-26; a comparação ao vivo com docs fica para o RD-2277.
const LOGOS: Record<string, string> = {
  'logo-macuxi-erp-positivo.png': 'a8102f05bd378384c99b2e636ee1fab815016d2c279e9b1e3725f22cc70dd08d',
  'logo-macuxi-erp-negativo-azul-noite.png': 'c41ffeb26ca3d4fef76ff9465457a6f0b3e14d99224f4cc0b5a6e9816d83a962',
};
const PUBLIC_EMAIL = new URL('../../public/email/', import.meta.url);
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('logos do e-mail em /email/', () => {
  it.each(Object.entries(LOGOS))('%s existe em public/email, é PNG e tem o sha256 do design', (nome, hash) => {
    const arquivo = new URL(nome, PUBLIC_EMAIL);
    expect(existsSync(arquivo)).toBe(true);
    const bytes = readFileSync(arquivo);
    expect(bytes.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  });

  it('nenhum middleware intercepta /email/ nem há rewrite/redirect no next.config', () => {
    const src = new URL('../', import.meta.url);
    expect(existsSync(new URL('middleware.ts', src))).toBe(false);
    expect(existsSync(new URL('proxy.ts', src))).toBe(false);
    const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
    expect(config).not.toMatch(/\b(rewrites|redirects|basePath)\b/);
  });
});
