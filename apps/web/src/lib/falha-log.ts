/**
 * Log de falha do servidor do web, SEM dado pessoal: só o tipo do erro (name, code, cause.code, digest) e o build.
 * Nunca a mensagem (pode citar URL, e-mail ou corpo), nem empresa, e-mail, senha ou token. Serve ao login e ao `buscarNaApi`.
 */
export const BUILD_WEB = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

const texto = (v: unknown): string | undefined => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 80) : undefined);

export function tipoDoErro(e: unknown): Record<string, string | undefined> {
  if (typeof e !== 'object' || e === null) return { name: typeof e };
  const o = e as { name?: unknown; code?: unknown; digest?: unknown; cause?: unknown };
  const causa = typeof o.cause === 'object' && o.cause !== null ? (o.cause as { name?: unknown; code?: unknown }) : undefined;
  return { name: texto(o.name) ?? 'Error', code: texto(o.code), causa_name: texto(causa?.name), causa_code: texto(causa?.code), digest: texto(o.digest) };
}

/** Uma linha JSON no stderr do servidor. `origem` é fixa do código (ex.: `login.api`), nunca dado do usuário. */
export function registrarFalha(origem: string, e: unknown): void {
  console.error(JSON.stringify({ evento: 'web.falha', origem, ...tipoDoErro(e), build: BUILD_WEB }));
}
