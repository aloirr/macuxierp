/** Troca NBSP (U+00A0) e espaço estreito (U+202F), que o Intl pt-BR pode gerar conforme o ICU, por espaço comum. */
export function semEspacoDuro<T extends string | null | undefined>(s: T): T {
  return (typeof s === 'string' ? s.replace(/[\u00A0\u202F]/g, ' ') : s) as T;
}
