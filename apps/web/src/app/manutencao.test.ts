import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 47 B (v0.3.22): página de manutenção do 502 na troca de containers, servida como estático em /manutencao.html,
 * sem login (o Next serve `public/` antes de qualquer rota; o shell não tem middleware nem proxy, ver email-logos.test).
 * HTML do designer-ux, gerado de `assinaturaANegativoAzulNoite` (packages/ui/src/marca.tsx); sha256 do envio dele.
 */
const ARQUIVO = new URL('../../public/manutencao.html', import.meta.url);
const SHA256_DESIGN = '95709ae1b2474b09669392d2376dfe82574e96bab97ec05dd7d21d5cd9fbc1a8';
const TEXTO = 'O site está em manutenção, aguarde alguns minutos e tente novamente.';

describe('página de manutenção (47 B)', () => {
  const html = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';

  it('existe em public/ e é o arquivo do designer (sha256)', () => {
    expect(html).not.toBe('');
    expect(createHash('sha256').update(readFileSync(ARQUIVO)).digest('hex')).toBe(SHA256_DESIGN);
  });

  it('traz o texto exato do Alexandre, uma vez, no h1; em pt-BR e fora da busca', () => {
    expect(html).toContain(`<h1>${TEXTO}</h1>`);
    expect(html.split(TEXTO)).toHaveLength(2);
    expect(html).toMatch(/<html lang="pt-BR">/);
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('não carrega nada de fora: sem script, link, img, iframe, @import, url() nem endereço http', () => {
    expect(html).not.toMatch(/<(script|link|img|iframe|object|embed|video|audio|source)\b/i);
    expect(html).not.toMatch(/@import/i);
    // url() só para referência interna do SVG (`url(#id)`, o recorte do sol), nunca para arquivo ou endereço.
    expect(html).not.toMatch(/url\(\s*['"]?(?!#)/i);
    expect(html).not.toMatch(/\s(src|href|srcset|action)=/i);
    // O único http é o namespace do SVG inline (não é requisição).
    expect([...html.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0])).toEqual(['http://www.w3.org/2000/svg']);
  });

  it('a logo é o SVG inline da assinatura negativa do @macuxierp/ui', () => {
    const marca = readFileSync(new URL('../../../../packages/ui/src/marca.tsx', import.meta.url), 'utf8');
    const svg = /export const assinaturaANegativoAzulNoite = '([^']+)'/.exec(marca)?.[1] ?? '';
    const caminhos = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const d of caminhos) expect(html).toContain(d);
  });
});
