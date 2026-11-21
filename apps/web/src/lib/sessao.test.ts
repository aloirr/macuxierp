import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { destinoSeguro } from './sessao';

describe('destinoSeguro', () => {
  it('aceita caminho interno', () => expect(destinoSeguro('/pedido/pedidos')).toBe('/pedido/pedidos'));
  it.each(['https://mau.exemplo', '//mau.exemplo', '/\\mau.exemplo', '', undefined, null])('rejeita %s', (d) =>
    expect(destinoSeguro(d)).toBe('/'),
  );
});
