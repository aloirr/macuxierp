const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Patch plano: só o que a linha trouxe, já normalizado (`undefined` não conta). */
export type Patch = Readonly<Record<string, unknown>>;

/** D5: o que mudaria no registro atual. Vazio = "sem mudança" (sem UPDATE, sem evento, `updated_at` intacto). */
export function camposAlterados(patch: Patch, atual: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(patch)
    .filter(([k, v]) => v !== undefined && !igual(v, atual[k]))
    .map(([k]) => k);
}

export const semMudanca = (patch: Patch, atual: Readonly<Record<string, unknown>>): boolean => camposAlterados(patch, atual).length === 0;
