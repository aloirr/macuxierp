/**
 * Cifra do A1 (ADR 0005): AES-256-GCM, um nonce por campo e o `tenant_id` como dado associado, para que o cifrado de
 * um tenant não abra em outro. A chave mestra vem do secret do servidor (`MACUXIERP_CHAVE_A1`) e nunca é logada.
 * O tag de autenticação (16 bytes) vai no fim do cifrado.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const TAG = 16;
const NONCE = 12;

/** Lê a chave (32 bytes em hex de 64 caracteres ou base64). O erro nunca ecoa o valor recebido. */
export function lerChaveA1(valor: string | undefined): Buffer {
  const v = (valor ?? '').trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (bytes.length !== 32) throw new Error('MACUXIERP_CHAVE_A1 ausente ou inválida: precisa de 32 bytes (hex ou base64)');
  return bytes;
}

export interface A1Cifrado {
  pfx_cifrado: Buffer;
  pfx_nonce: Buffer;
  senha_cifrada: Buffer;
  senha_nonce: Buffer;
}

function cifrar(chave: Buffer, tenantId: string, claro: Buffer, nonce: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', chave, nonce);
  c.setAAD(Buffer.from(tenantId, 'utf8'));
  return Buffer.concat([c.update(claro), c.final(), c.getAuthTag()]);
}

function decifrar(chave: Buffer, tenantId: string, cifrado: Buffer, nonce: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', chave, nonce);
  d.setAAD(Buffer.from(tenantId, 'utf8'));
  d.setAuthTag(cifrado.subarray(cifrado.length - TAG));
  return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - TAG)), d.final()]);
}

export function cifrarA1(p: { chave: Buffer; tenantId: string; pfx: Buffer; senha: string }): A1Cifrado {
  let pfxNonce = randomBytes(NONCE);
  const senhaNonce = randomBytes(NONCE);
  while (pfxNonce.equals(senhaNonce)) pfxNonce = randomBytes(NONCE); // o banco exige nonces distintos
  return {
    pfx_cifrado: cifrar(p.chave, p.tenantId, p.pfx, pfxNonce),
    pfx_nonce: pfxNonce,
    senha_cifrada: cifrar(p.chave, p.tenantId, Buffer.from(p.senha, 'utf8'), senhaNonce),
    senha_nonce: senhaNonce,
  };
}

/** Só o worker (assinatura da NF-e) e os testes abrem; as rotas nunca devolvem o resultado. */
export function decifrarA1(p: { chave: Buffer; tenantId: string } & A1Cifrado): { pfx: Buffer; senha: string } {
  return {
    pfx: decifrar(p.chave, p.tenantId, p.pfx_cifrado, p.pfx_nonce),
    senha: decifrar(p.chave, p.tenantId, p.senha_cifrada, p.senha_nonce).toString('utf8'),
  };
}
