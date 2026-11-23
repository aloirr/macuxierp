import { describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxierp/platform-sdk';
import { manifest } from './manifest';

describe('manifesto do módulo core', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('core');
    expect(manifest.publica.every((e) => e.startsWith('core.'))).toBe(true);
  });

  it('RN-CORE-09: o core oferece todos os perfis do SDK, menos o analista de implantação', () => {
    expect([...manifest.perfis].sort()).toEqual(PERFIS.filter((p) => p !== 'analista_implantacao').sort());
  });
});
