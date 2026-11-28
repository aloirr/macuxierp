/**
 * RN-CORE-18: o e-mail do usuário é único em todo o sistema (usuários de todas as empresas e superadmin da
 * Plataforma), normalizado em minúsculas e sem espaços, contando só as contas vivas. Funções puras: a consulta
 * "existe e-mail vivo em outra conta" é uma porta (banco-dados, 0079).
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
