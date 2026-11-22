/**
 * Cifra de campo genérica (ADR 0005, extraída do padrão de `modules/core/api/cifra.ts`): AES-256-GCM, nonce de 12 bytes
 * novo a cada cifra e o `tenant_id` (utf8) como dado associado, para que o cifrado de um tenant não abra em outro.
 * Formato guardado: `nonce(12) + cifrado + tag(16)`, num campo só.
 * A chave mestra vem de um secret do servidor (uma variável por finalidade: `MACUXIERP_CHAVE_A1`,
 * `MACUXIERP_CHAVE_INTEGRACAO`...) e nunca é logada. Os erros têm mensagem fixa: nunca ecoam chave, claro nem cifrado.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const NONCE = 12;
const TAG = 16;
const ALGORITMO = 'aes-256-gcm';

/** Erro da cifra. A mensagem é fixa (ou cita só o nome da variável de ambiente). */
export class ErroCifra extends Error {
  override readonly name = 'ErroCifra';
}

/** Lê a chave mestra (32 bytes em hex de 64 caracteres ou base64). O erro cita só `nomeVar`, nunca o valor. */
export function lerChaveMestra(nomeVar: string, valor: string | undefined): Buffer {
  const v = (valor ?? '').trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : /^[A-Za-z0-9+/]+={0,2}$/.test(v) ? Buffer.from(v, 'base64') : Buffer.alloc(0);
  if (bytes.length !== 32) throw new ErroCifra(`${nomeVar} ausente ou inválida: precisa de 32 bytes (hex ou base64)`);
  return bytes;
}

function conferirChave(chave: Buffer): void {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new ErroCifra('cifra: chave inválida');
}

export function cifrarCampo({ chave, tenantId, claro }: { chave: Buffer; tenantId: string; claro: Buffer | string }): Buffer {
  conferirChave(chave);
  const nonce = randomBytes(NONCE);
  const c = createCipheriv(ALGORITMO, chave, nonce);
  c.setAAD(Buffer.from(tenantId, 'utf8'));
  const dado = typeof claro === 'string' ? Buffer.from(claro, 'utf8') : claro;
  return Buffer.concat([nonce, c.update(dado), c.final(), c.getAuthTag()]);
}

/** Abre o que `cifrarCampo` gerou. Tamanho, tenant, chave ou adulteração errados: `ErroCifra` de mensagem fixa. */
export function decifrarCampo({ chave, tenantId, cifrado }: { chave: Buffer; tenantId: string; cifrado: Uint8Array }): Buffer {
  conferirChave(chave);
  const b = Buffer.from(cifrado.buffer, cifrado.byteOffset, cifrado.byteLength);
  if (b.length < NONCE + TAG) throw new ErroCifra('cifra: cifrado inválido');
  try {
    const d = createDecipheriv(ALGORITMO, chave, b.subarray(0, NONCE));
    d.setAAD(Buffer.from(tenantId, 'utf8'));
    d.setAuthTag(b.subarray(b.length - TAG));
    return Buffer.concat([d.update(b.subarray(NONCE, b.length - TAG)), d.final()]);
  } catch {
    // a mensagem do node:crypto não sai daqui
    throw new ErroCifra('cifra: falha de autenticação');
  }
}
