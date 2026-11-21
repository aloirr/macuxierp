import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrarA1, decifrarA1, lerChaveA1 } from './cifra';

describe('ADR 0005: cifra do A1 (AES-256-GCM)', () => {
  const chave = lerChaveA1(randomBytes(32).toString('hex'));
  const tenant = '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e11';

  it('ADR 0005: ida e volta com tenant como dado associado; nonce de 12 bytes e distintos', () => {
    const pfx = randomBytes(2000);
    const a = cifrarA1({ chave, tenantId: tenant, pfx, senha: 'segredo-de-teste' });
    expect(a.pfx_nonce).toHaveLength(12);
    expect(a.senha_nonce).toHaveLength(12);
    expect(a.pfx_nonce.equals(a.senha_nonce)).toBe(false);
    expect(a.pfx_cifrado.includes(pfx.subarray(0, 32))).toBe(false);
    const volta = decifrarA1({ chave, tenantId: tenant, ...a });
    expect(volta.pfx.equals(pfx)).toBe(true);
    expect(volta.senha).toBe('segredo-de-teste');
  });

  it('ADR 0005: outro tenant, outra chave ou adulteração não abrem', () => {
    const a = cifrarA1({ chave, tenantId: tenant, pfx: randomBytes(100), senha: 'x' });
    expect(() => decifrarA1({ chave, tenantId: '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e12', ...a })).toThrow();
    expect(() => decifrarA1({ chave: lerChaveA1(randomBytes(32).toString('hex')), tenantId: tenant, ...a })).toThrow();
    a.pfx_cifrado[0] = (a.pfx_cifrado[0] ?? 0) ^ 1;
    expect(() => decifrarA1({ chave, tenantId: tenant, ...a })).toThrow();
  });

  it('ADR 0005: a chave do secret precisa ter 32 bytes (hex ou base64) e o erro não ecoa o valor', () => {
    expect(() => lerChaveA1('curta-demais')).toThrow(/MACUXIERP_CHAVE_A1/);
    try {
      lerChaveA1('valor-sigiloso-qualquer');
    } catch (e) {
      expect(String(e)).not.toContain('valor-sigiloso-qualquer');
    }
    expect(lerChaveA1(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});
