import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { destinoSeguro } from './sessao';

describe('destinoSeguro', () => {
  it('aceita caminho interno', () => expect(destinoSeguro('/pedido/pedidos')).toBe('/pedido/pedidos'));
  it('aceita caminho com consulta', () => expect(destinoSeguro('/pedido/lista?x=1')).toBe('/pedido/lista?x=1'));
  // O destino nunca é decodificado aqui: %09 fica literal no caminho e o navegador não o trata como TAB.
  it('mantém %09 literal (não é decodificado)', () => expect(destinoSeguro('/%09/evil.com')).toBe('/%09/evil.com'));
  it.each(['https://mau.exemplo', '//mau.exemplo', '/\\mau.exemplo', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/a\u0000b', '', undefined, null])('rejeita %s', (d) =>
    expect(destinoSeguro(d)).toBe('/'),
  );
});
