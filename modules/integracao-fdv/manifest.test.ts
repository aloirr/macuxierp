import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo integracao-fdv', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('integracao-fdv');
    expect(manifest.publica.every((e) => e.startsWith('integracao-fdv.'))).toBe(true);
  });
});
