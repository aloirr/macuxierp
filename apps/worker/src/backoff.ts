/** Retentativa com espera exponencial (RN-INF-04): 10 s, 20 s, 40 s... até 1 h. */
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_TETO_MS = 3_600_000;

export function proximaTentativa(agora: Date, tentativas: number): Date {
  const espera = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, tentativas - 1), BACKOFF_TETO_MS);
  return new Date(agora.getTime() + espera);
}

/**
 * Texto do erro para a coluna `erro` (nunca para o log): nome e mensagem, cortados em 500 caracteres.
 * No log vai só o nome, porque a mensagem pode trazer valor de dado pessoal.
 */
export function textoDoErro(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e));
  return `${err.name}: ${err.message}`.slice(0, 500);
}

export const nomeDoErro = (e: unknown) => (e instanceof Error ? e.name : typeof e);
