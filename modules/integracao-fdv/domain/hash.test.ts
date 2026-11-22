import { describe, expect, it } from 'vitest';
import { paraHex, sha1, sha256, utf8 } from './hash';

// Vetores gerados com o node:crypto fora do domain (o domain não importa módulo do Node).
describe('hash puro (RN-INF-03)', () => {
  it('SHA-256: vetores conhecidos, UTF-8 multibyte e bordas de bloco', () => {
    expect(paraHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(paraHex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(paraHex(sha256(utf8('ç'.repeat(55))))).toBe('b3b07ed35b76f4a0af9d6e274bb56aab6e2b1855a90eb38c7f982f7c87648e26');
    expect(paraHex(sha256(utf8('ç'.repeat(64))))).toBe('a8b51af81aa0402d542a264a9d096893a30ae5743283927068a7b90282d71e91');
    expect(paraHex(sha256(utf8('ç'.repeat(100_000))))).toBe('a63d597422764f06a5e4a62f00f45e8c44728f15abe276d9ab34258a2926be02');
  });

  it('SHA-1: vetores conhecidos', () => {
    expect(paraHex(sha1(utf8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(paraHex(sha1(utf8('x'.repeat(64))))).toBe('bb2fa3ee7afb9f54c6dfb5d021f14b1ffe40c163');
    expect(paraHex(sha1(utf8('x'.repeat(1000))))).toBe('c3efa690fa3fdd2e2526853eed670538ea127638');
  });
});
