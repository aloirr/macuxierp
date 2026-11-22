/**
 * Adaptadores PostgreSQL das portas da plataforma (`@macuxierp/platform-sdk/pg`), usados só pelos apps (API e worker):
 * o módulo recebe a `Transacao` pronta no `ContextoRota` e nunca abre conexão.
 *
 * - `BancoPg`: uma transação por chamada; `comTenant` põe o tenant com `set_config('app.tenant_id', ..., true)` (o
 *   equivalente a `SET LOCAL`: vale só na transação, nunca na conexão do pool). `papel` faz `SET LOCAL ROLE` (testes e
 *   admin); em produção a conexão já é do papel (`macuxierp_app` na API, `macuxierp_worker` no worker).
 * - Outbox, auditoria, fila de trabalho, catálogo de arquivos, licenças e `Idempotency-Key` sobre `plataforma.*`
 *   (migração 0002).
 * Conexão pelas variáveis padrão do libpq (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`): nada de senha em
 * código.
 */
import pg from 'pg';
import type { Licenca, FonteLicencas } from './acesso';
import type { CatalogoArquivos, RegistroArquivo } from './arquivos';
import type { DestinoAuditoria, RegistroAuditoria } from './auditoria';
import { PADRAO_UUID, type Banco, type Transacao } from './banco';
import { erros } from './erros';
import type { EnvelopeEvento, Outbox } from './eventos';
import type { ConclusaoIdempotencia, RegistroIdempotencia, RepositorioIdempotencia, ReservaIdempotencia } from './idempotencia';
import type { FilaDeTrabalhos, PedidoTrabalho } from './trabalhos';

const PAPEL = /^[a-z_][a-z0-9_]*$/;

export interface OpcoesBancoPg {
  /** `SET LOCAL ROLE` em toda transação (conexão de admin nos testes). Sem ele, vale o usuário da conexão. */
  papel?: string;
}

/** Pool pelas variáveis do libpq (PG*). `max` padrão 10; `application_name` identifica o processo no servidor. */
export function criarPool(nome: string, max = 10): pg.Pool {
  return new pg.Pool({ max, application_name: nome, idleTimeoutMillis: 30_000 });
}

export class BancoPg implements Banco {
  constructor(
    private readonly pool: pg.Pool,
    private readonly opcoes: OpcoesBancoPg = {},
  ) {
    if (opcoes.papel !== undefined && !PAPEL.test(opcoes.papel)) throw new RangeError('BancoPg: papel inválido');
  }

  async comTenant<R>(tenantId: string, fn: (tx: Transacao) => Promise<R>): Promise<R> {
    if (!PADRAO_UUID.test(tenantId)) throw new RangeError('BancoPg.comTenant: tenant não é UUID');
    return this.transacao(tenantId, fn);
  }

  semTenant<R>(fn: (tx: Transacao) => Promise<R>): Promise<R> {
    return this.transacao(null, fn);
  }

  async ping(): Promise<boolean> {
    const r = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  }

  /**
   * Confere o papel efetivo na partida do processo: recusa superusuário e BYPASSRLS (a RLS não valeria) e papel
   * diferente do esperado.
   */
  async conferirPapel(esperado: string): Promise<void> {
    const [r] = await this.semTenant((tx) =>
      tx.consultar<{ papel: string; super: boolean; ignora_rls: boolean }>(
        'SELECT current_user AS papel, rolsuper AS super, rolbypassrls AS ignora_rls FROM pg_roles WHERE rolname = current_user',
      ),
    );
    if (!r || r.super || r.ignora_rls || r.papel !== esperado) {
      throw new Error(`conexão no papel ${r?.papel ?? '?'} (esperado ${esperado}, sem superusuário nem BYPASSRLS)`);
    }
  }

  private async transacao<R>(tenantId: string | null, fn: (tx: Transacao) => Promise<R>): Promise<R> {
    const cliente = await this.pool.connect();
    let quebrada: Error | undefined;
    let fila: Promise<unknown> = Promise.resolve();
    try {
      await cliente.query('BEGIN');
      if (this.opcoes.papel) await cliente.query(`SET LOCAL ROLE ${this.opcoes.papel}`);
      if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      // Uma conexão roda um comando por vez: consultas em paralelo (Promise.all) entram em fila, e o COMMIT ou o
      // ROLLBACK só sai depois da última.
      const tx: Transacao = {
        consultar: <L>(sql: string, parametros: readonly unknown[] = []) => {
          const r = fila.then(() => cliente.query(sql, parametros as unknown[]));
          fila = r.catch(() => undefined);
          return r.then((x) => x.rows as L[]);
        },
      };
      const r = await fn(tx);
      await fila;
      await cliente.query('COMMIT');
      return r;
    } catch (e) {
      await fila;
      await cliente.query('ROLLBACK').catch((erro: Error) => {
        quebrada = erro; // conexão quebrada não volta ao pool
      });
      throw e;
    } finally {
      cliente.release(quebrada);
    }
  }
}

/**
 * A `plataforma.evento` (migração 0002) não tem colunas para `ator` e `request_id` do envelope: até o banco-dados
 * criá-las, a coluna `payload` guarda `{ ator, request_id, payload }`. Só estas duas funções conhecem o formato.
 */
export interface LinhaEvento {
  id: string;
  tenant_id: string;
  nome: string;
  agregado_id: string;
  versao: string | number;
  ocorrido_em: Date;
  payload: { ator: EnvelopeEvento['ator']; request_id: string; payload: Record<string, unknown> };
}

export const SELECT_EVENTO = 'id, tenant_id, nome, agregado_id, versao, ocorrido_em, payload';

export function envelopeDaLinha(l: LinhaEvento): EnvelopeEvento {
  return {
    id: l.id,
    nome: l.nome,
    tenant_id: l.tenant_id,
    agregado_id: l.agregado_id,
    versao: Number(l.versao),
    ocorrido_em: l.ocorrido_em.toISOString(),
    ator: l.payload.ator,
    request_id: l.payload.request_id,
    payload: l.payload.payload,
  };
}

export class OutboxPg implements Outbox {
  async gravar(tx: Transacao, e: EnvelopeEvento): Promise<void> {
    const corpo: LinhaEvento['payload'] = { ator: e.ator, request_id: e.request_id, payload: e.payload };
    await tx.consultar(
      `INSERT INTO plataforma.evento (id, tenant_id, nome, agregado_id, versao, ocorrido_em, proximo_em, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
      [e.id, e.tenant_id, e.nome, e.agregado_id, e.versao, e.ocorrido_em, corpo],
    );
  }
}

export class AuditoriaPg implements DestinoAuditoria {
  async inserir(tx: Transacao, r: RegistroAuditoria): Promise<void> {
    await tx.consultar(
      `INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      // jsonb pelo texto: um valor de string ("x") também vira JSON válido.
      [r.tenant_id, r.usuario_id, r.acao, r.entidade, r.entidade_id, JSON.stringify(r.antes), JSON.stringify(r.depois), r.request_id, r.ocorrido_em],
    );
  }
}

export class FilaDeTrabalhosPg implements FilaDeTrabalhos {
  /** Idempotente por `external_id` (único por tenant): o reenvio devolve o id do trabalho já enfileirado. */
  async enfileirar(tx: Transacao, p: PedidoTrabalho): Promise<{ id: string }> {
    const [novo] = await tx.consultar<{ id: string }>(
      `INSERT INTO plataforma.trabalho (tenant_id, tipo, payload, external_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
      [p.tenant_id, p.tipo, p.payload, p.external_id ?? null],
    );
    if (novo) return novo;
    const [existente] = await tx.consultar<{ id: string; tipo: string }>(
      'SELECT id, tipo FROM plataforma.trabalho WHERE tenant_id = $1 AND external_id = $2',
      [p.tenant_id, p.external_id],
    );
    if (!existente || existente.tipo !== p.tipo) throw erros.conflito('external_id já usado por outro trabalho');
    return { id: existente.id };
  }
}

export class CatalogoArquivosPg implements CatalogoArquivos {
  async inserir(tx: Transacao, r: RegistroArquivo): Promise<void> {
    await tx.consultar(
      `INSERT INTO plataforma.arquivo (id, tenant_id, chave_s3, tipo, sha256, tamanho, imutavel, guarda_ate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.id, r.tenant_id, r.chave_s3, r.tipo, r.sha256, r.tamanho, r.imutavel, r.guarda_ate?.toISOString().slice(0, 10) ?? null],
    );
  }
}

/** `plataforma.tenant_modulo` do tenant da transação (a RLS só mostra a dele). */
export class LicencasPg implements FonteLicencas {
  async ler(tx: Transacao, tenantId: string): Promise<Licenca[]> {
    return tx.consultar<Licenca>(
      'SELECT modulo, ativo, valido_ate FROM plataforma.tenant_modulo WHERE tenant_id = $1 AND deleted_at IS NULL',
      [tenantId],
    );
  }
}

/**
 * `plataforma.idempotencia` na transação do tenant (RLS). A vencida é apagada e substituída; a reserva concorrente com
 * a mesma chave espera o `COMMIT` da 1ª no índice único e então lê a resposta dela.
 */
export class IdempotenciaPg implements RepositorioIdempotencia {
  async reservar(tx: Transacao, p: ReservaIdempotencia): Promise<RegistroIdempotencia | null> {
    const chave = [p.tenant_id, p.chave, p.rota];
    await tx.consultar('DELETE FROM plataforma.idempotencia WHERE tenant_id = $1 AND chave = $2 AND rota = $3 AND expira_em <= $4', [...chave, p.agora]);
    const [nova] = await tx.consultar<{ id: string }>(
      `INSERT INTO plataforma.idempotencia (tenant_id, chave, rota, hash_corpo, expira_em) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, chave, rota) DO NOTHING RETURNING id`,
      [...chave, p.hash_corpo, p.expira_em],
    );
    if (nova) return null;
    const [r] = await tx.consultar<RegistroIdempotencia>(
      'SELECT hash_corpo, status, resposta FROM plataforma.idempotencia WHERE tenant_id = $1 AND chave = $2 AND rota = $3',
      chave,
    );
    if (!r) throw erros.conflito('Idempotency-Key em uso: tente de novo');
    return r;
  }

  async concluir(tx: Transacao, p: ConclusaoIdempotencia): Promise<void> {
    await tx.consultar(
      'UPDATE plataforma.idempotencia SET status = $4, resposta = $5::jsonb WHERE tenant_id = $1 AND chave = $2 AND rota = $3',
      // jsonb pelo texto (como na auditoria): string ou null também viram JSON válido.
      [p.tenant_id, p.chave, p.rota, p.status, JSON.stringify(p.resposta ?? null)],
    );
  }
}
