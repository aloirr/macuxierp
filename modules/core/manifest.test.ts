import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo core', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('core');
    expect(manifest.publica.every((e) => e.startsWith('core.'))).toBe(true);
  });
});
