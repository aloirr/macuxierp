/** SQLSTATE do erro do driver `pg` (campo `code`), ou `undefined` se não for erro de banco. */
export const sqlstate = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

/** Índice único global do e-mail do usuário (0079, RN-CORE-18). */
const INDICE_EMAIL_GLOBAL = 'usuario_email_global_uq';

/**
 * 23505 do e-mail em uso: o índice `usuario_email_global_uq` ou o `email_em_uso` que `empresa_usuario_criar` e
 * `empresa_primeiro_admin_criar` levantam (0079). Outro 23505 (slug, CNPJ) não entra.
 */
export function ehEmailEmUso(e: unknown): boolean {
  if (sqlstate(e) !== '23505') return false;
  const { constraint, message } = e as { constraint?: unknown; message?: unknown };
  return constraint === INDICE_EMAIL_GLOBAL || (typeof message === 'string' && (message.includes(INDICE_EMAIL_GLOBAL) || message.includes('email_em_uso')));
}
