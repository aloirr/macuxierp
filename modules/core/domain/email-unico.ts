/**
 * RN-CORE-18: o e-mail do usuário é único entre os usuários de todas as empresas, normalizado em minúsculas e
 * sem espaços, contando só as contas vivas. O superadmin da Plataforma fica fora (decisão 45 A: o /config abre
 * pelo BKO com o mesmo e-mail). Quem barra é o índice global da 0079 (`usuario_email_global_uq`).
 */
export function normalizarEmailUsuario(email: string): string {
  return email.replace(/\s+/g, '').toLowerCase();
}
