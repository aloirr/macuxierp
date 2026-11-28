/**
 * RN-CORE-18: o e-mail do usuário é único entre os usuários de todas as empresas, normalizado em minúsculas e
 * sem espaços, contando só as contas vivas. O superadmin da Plataforma fica fora (decisão 45 A: o /config abre
 * pelo BKO com o mesmo e-mail). Funções puras: a consulta é uma porta (banco-dados, 0079).
 */
export const CODIGO_EMAIL_EM_USO = 'EMAIL_EM_USO';
export const MENSAGEM_EMAIL_EM_USO_GLOBAL = 'Este e-mail já está em uso em outra empresa. Use outro e-mail.';

export function normalizarEmailUsuario(email: string): string {
  return email.replace(/\s+/g, '').toLowerCase();
}

export type DecisaoEmailUnico = { ok: true } | { ok: false; codigo: typeof CODIGO_EMAIL_EM_USO; mensagem: string };

export function decidirEmailUnico(p: { existe_vivo_em_outra_conta: boolean }): DecisaoEmailUnico {
  return p.existe_vivo_em_outra_conta ? { ok: false, codigo: CODIGO_EMAIL_EM_USO, mensagem: MENSAGEM_EMAIL_EM_USO_GLOBAL } : { ok: true };
}
