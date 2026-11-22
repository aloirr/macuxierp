/**
 * Corte e junção do A1 entre o formato do SDK (`nonce(12) + cifrado + tag(16)`) e as colunas de `core.certificado`
 * (`*_nonce` e `*_cifrado`/`*_cifrada`, db/migrations/0003_core.sql). A cifra em si é a do SDK (ADR 0005).
 */
import { cifrarCampo, decifrarCampo } from '@macuxierp/platform-sdk';
import type { A1Cifrado } from './portas';

const NONCE = 12;

/** Cifra o pfx e a senha; recifra a senha enquanto o nonce igualar o do pfx (CHECK certificado_nonces_distintos). */
export function cifrarColunasA1(p: { chave: Buffer; tenantId: string; pfx: Buffer; senha: string }): A1Cifrado {
  const pfx = cifrarCampo({ chave: p.chave, tenantId: p.tenantId, claro: p.pfx });
  let senha = cifrarCampo({ chave: p.chave, tenantId: p.tenantId, claro: p.senha });
  while (senha.subarray(0, NONCE).equals(pfx.subarray(0, NONCE))) senha = cifrarCampo({ chave: p.chave, tenantId: p.tenantId, claro: p.senha });
  return { pfx_nonce: pfx.subarray(0, NONCE), pfx_cifrado: pfx.subarray(NONCE), senha_nonce: senha.subarray(0, NONCE), senha_cifrada: senha.subarray(NONCE) };
}

/** Junta nonce e cifrado e abre pelo SDK; `ErroCifra` de mensagem fixa se tenant, chave ou bytes não conferem. */
export function abrirColunasA1(p: { chave: Buffer; tenantId: string } & A1Cifrado): { pfx: Buffer; senha: string } {
  return {
    pfx: decifrarCampo({ chave: p.chave, tenantId: p.tenantId, cifrado: Buffer.concat([p.pfx_nonce, p.pfx_cifrado]) }),
    senha: decifrarCampo({ chave: p.chave, tenantId: p.tenantId, cifrado: Buffer.concat([p.senha_nonce, p.senha_cifrada]) }).toString('utf8'),
  };
}
