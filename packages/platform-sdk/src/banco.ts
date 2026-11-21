/**
 * Portas de banco da plataforma. O adaptador PostgreSQL (pg) vive nos apps; o SDK só conhece a interface, para que
 * domain e testes rodem sem banco.
 *
 * `comTenant` abre uma transação e faz `SET LOCAL app.tenant_id` (RLS, desenho T-0002 seção 2): toda leitura e escrita
 * de módulo passa por aqui. `semTenant` é só para a plataforma antes de saber o tenant (login, worker) e usa as
 * funções/papéis que o banco-dados expõe para isso (T-0003).
 */

export interface Transacao {
  consultar<L = Record<string, unknown>>(sql: string, parametros?: readonly unknown[]): Promise<L[]>;
}

export interface Banco {
  comTenant<R>(tenantId: string, fn: (tx: Transacao) => Promise<R>): Promise<R>;
  semTenant<R>(fn: (tx: Transacao) => Promise<R>): Promise<R>;
  /** `/v1/saude`: o banco responde? */
  ping(): Promise<boolean>;
}

/** Relógio injetável (testes sem hora real; datas em UTC, RN-CORE-04). */
export interface Relogio {
  agora(): Date;
}

/** UUID (RN-CORE-04): ids, `tenant_id` e o prefixo do refresh. */
export const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
