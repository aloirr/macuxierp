/** SQLSTATE do erro do driver `pg` (campo `code`), ou `undefined` se não for erro de banco. */
export const sqlstate = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
