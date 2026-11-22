/** Regras da credencial do conector (RF-INF-05). Funções puras. */

/** Máximo de caracteres da chave exibidos no BKO. */
export const PREFIXO_MAXIMO = 8;

/**
 * Prefixo exibido da chave: no máximo 8 caracteres e no máximo 1/4 da chave (arredondado para baixo), para nunca
 * revelar parte relevante de uma chave curta. Chave vazia ou muito curta devolve `''`.
 */
export function prefixoExibido(chave: string): string {
  const n = Math.min(PREFIXO_MAXIMO, Math.floor(chave.length / 4));
  return chave.slice(0, Math.max(0, n));
}
