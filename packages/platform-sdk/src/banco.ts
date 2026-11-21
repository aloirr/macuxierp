/**
 * Portas de banco da plataforma. O adaptador PostgreSQL é o `BancoPg` (`@macuxierp/platform-sdk/pg`), usado só pelos
 * apps; domain e testes de unidade rodam sem banco.
 *
 * `comTenant` abre uma transação e põe o `app.tenant_id` só nela (RLS, desenho T-0002 seção 2): toda leitura e escrita
 * de módulo passa por aqui. `semTenant` é só para a plataforma antes de saber o tenant (login, worker) e usa as
 * funções e papéis do banco para isso (`plataforma.tenant_por_slug()`, política `worker_global`).
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

/** Relógio real (processos da API e do worker). */
export const relogioDoSistema: Relogio = { agora: () => new Date() };
