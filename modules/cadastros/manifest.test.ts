import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo cadastros', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('cadastros');
    expect(manifest.publica.every((e) => e.startsWith('cadastros.'))).toBe(true);
  });
});
