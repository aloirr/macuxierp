import { CODIGO_EMAIL_EM_USO, MENSAGEM_EMAIL_EM_USO } from '@macuxierp/platform-sdk';

/** ADR 0021 §1: 409 com `detalhes.codigo = email_em_uso` vira o texto do SDK junto do campo e-mail; qualquer outro caso devolve null. */
export function erroEmailEmUso(status: number, detalhes: { codigo?: unknown } | undefined): { mensagem: string; campos: { email: string } } | null {
  if (status !== 409 || detalhes?.codigo !== CODIGO_EMAIL_EM_USO) return null;
  return { mensagem: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO } };
}
