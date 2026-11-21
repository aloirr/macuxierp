import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo faturamento', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('faturamento');
    expect(manifest.publica.every((e) => e.startsWith('faturamento.'))).toBe(true);
  });
});
