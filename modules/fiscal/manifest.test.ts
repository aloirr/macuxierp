import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo fiscal', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('fiscal');
    expect(manifest.publica.every((e) => e.startsWith('fiscal.'))).toBe(true);
  });
});
