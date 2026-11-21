import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo pedido', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('pedido');
    expect(manifest.publica.every((e) => e.startsWith('pedido.'))).toBe(true);
  });
});
