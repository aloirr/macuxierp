/** Compatibilidade do A1 já gravado (cifra própria do core, ADR 0005) com a cifra do SDK. Tudo sintético: nenhum A1 real. */
import { createDecipheriv } from 'node:crypto';
import { ErroCifra } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { abrirColunasA1, cifrarColunasA1 } from './colunas-a1';
import type { A1Cifrado } from './portas';

const CHAVE_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const CHAVE = Buffer.from(CHAVE_HEX, 'hex');
const TENANT = '11111111-2222-4333-8444-555555555555';
const OUTRO_TENANT = '11111111-2222-4333-8444-555555555556';
const PFX = Buffer.from('pfx-sintetico-0123456789');
const SENHA = 'senha-sintetica';
// Vetor gerado pelo cifra.ts antigo (AES-256-GCM, AAD = tenant, cifrado + tag), com estes nonces fixos.
const NONCE_PFX = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaab', 'hex');
const NONCE_SENHA = Buffer.from('b0b1b2b3b4b5b6b7b8b9babb', 'hex');
const CIFRADO_PFX = Buffer.from('967e040036a26ccb0711eeb06857f0ef429f6d25a4807a556225003f73422bfd190900ac1e243a81', 'hex');
const CIFRADA_SENHA = Buffer.from('ea3034c38de0c836298cf2d6a43ee9d9e061e2ad3fb04b7f50fb3ec96eba14', 'hex');
const ANTIGO: A1Cifrado = { pfx_cifrado: CIFRADO_PFX, pfx_nonce: NONCE_PFX, senha_cifrada: CIFRADA_SENHA, senha_nonce: NONCE_SENHA };

/** Cópia mínima do decifrarA1 antigo, só como referência. */
function decifrarAntigo(chave: Buffer, tenantId: string, cifrado: Buffer, nonce: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', chave, nonce);
  d.setAAD(Buffer.from(tenantId, 'utf8'));
  d.setAuthTag(cifrado.subarray(cifrado.length - 16));
  return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
}

describe('T-0011: compatibilidade da cifra antiga do core com a do SDK (ADR 0005)', () => {
  it('ADR 0005: o vetor gravado pela cifra antiga abre pelo SDK com nonce + cifrado', () => {
    expect(abrirColunasA1({ chave: CHAVE, tenantId: TENANT, ...ANTIGO })).toEqual({ pfx: PFX, senha: SENHA });
  });

  it('ADR 0005: o que o SDK cifra e o corte separa abre pelo decifrarA1 antigo', () => {
    const novo = cifrarColunasA1({ chave: CHAVE, tenantId: TENANT, pfx: PFX, senha: SENHA });
    expect(decifrarAntigo(CHAVE, TENANT, novo.pfx_cifrado, novo.pfx_nonce).equals(PFX)).toBe(true);
    expect(decifrarAntigo(CHAVE, TENANT, novo.senha_cifrada, novo.senha_nonce).toString('utf8')).toBe(SENHA);
  });

  it('ADR 0005: outro tenant, outra chave e um byte adulterado lançam ErroCifra no cifrado antigo', () => {
    const outraChave = Buffer.alloc(32, 7);
    expect(() => abrirColunasA1({ chave: CHAVE, tenantId: OUTRO_TENANT, ...ANTIGO })).toThrow(ErroCifra);
    expect(() => abrirColunasA1({ chave: outraChave, tenantId: TENANT, ...ANTIGO })).toThrow(ErroCifra);
    const adulterado = Buffer.from(ANTIGO.pfx_cifrado);
    adulterado[0] = (adulterado[0] ?? 0) ^ 1;
    expect(() => abrirColunasA1({ chave: CHAVE, tenantId: TENANT, ...ANTIGO, pfx_cifrado: adulterado })).toThrow(ErroCifra);
  });

  it('ADR 0005: nonces de 12 bytes e distintos entre pfx e senha (regra do CHECK)', () => {
    const x = cifrarColunasA1({ chave: CHAVE, tenantId: TENANT, pfx: PFX, senha: SENHA });
    expect(x.pfx_nonce).toHaveLength(12);
    expect(x.senha_nonce).toHaveLength(12);
    expect(x.pfx_nonce.equals(x.senha_nonce)).toBe(false);
  });
});
