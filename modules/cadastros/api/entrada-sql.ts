/**
 * T-0057 C3/C4: porta e adaptador SQL das tabelas da entrada (0071): lote, cursor e sinal. A API (papel `macuxierp_app`) cria o
 * lote, lê o resultado e o cursor e grava o sinal; o worker (`macuxierp_worker`) pega o lote da fila, grava o resultado e avança
 * o cursor. O `tenant_id` vem sempre da transação (`plataforma.tenant_atual()`, RLS). Nunca guarda nem devolve o dado dos registros
 * depois do estado final: o `corpo` é zerado e os erros levam só índice, `external_id`, campo e código (LGPD).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { CorpoLote, CursorHub, ModoLote } from '@macuxierp/platform-sdk/hub-v1';
import { cursorDaLinha, type ErroGuardado, type estadoFinalDoLote, type LoteGuardado } from '../domain';

export interface LoteCriado {
  id: string;
  entidade: string;
  modo: ModoLote;
  recebidos: number;
  hash_corpo: string;
}

export interface LotePendente {
  id: string;
  conector_id: string;
  entidade: string;
  corpo: unknown;
  recebidos: number;
}

export interface ResultadoGravado {
  estado: ReturnType<typeof estadoFinalDoLote>;
  com_erro: number;
  contagens: Readonly<Record<string, number>>;
  erros: readonly ErroGuardado[];
  cursor: CursorHub | null;
}

export interface SinalGravado {
  versao_conector: string;
  parado_por_versao: boolean;
}

export interface RepositorioEntrada {
  /** Cria o lote `recebido`; com a mesma `Idempotency-Key` do conector devolve o que já existe (`criado: false`). */
  criarLote(p: {
    credencial_id: string; conector_id: string; entidade: string; modo: ModoLote; idempotency_key: string; hash_corpo: string;
    corpo: CorpoLote; recebidos: number;
  }): Promise<{ lote: LoteCriado; criado: boolean }>;
  lerLote(conectorId: string, id: string): Promise<LoteGuardado | null>;
  lerCursor(conectorId: string, entidade: string): Promise<{ cursor: CursorHub | null; atualizado_em: string | null } | null>;
  gravarSinal(conectorId: string, s: SinalGravado, agora: Date): Promise<void>;
  // Worker
  /** Trava a fila da entidade do conector e devolve o lote `recebido` mais antigo dela (um por vez, na ordem de chegada). */
  proximoDaFila(loteId: string): Promise<LotePendente | null>;
  marcarProcessando(id: string, agora: Date): Promise<void>;
  concluir(id: string, r: ResultadoGravado, agora: Date): Promise<void>;
  falhar(id: string, codigo: string, agora: Date): Promise<void>;
  avancarCursor(conectorId: string, entidade: string, cursor: CursorHub, loteId: string): Promise<void>;
  /** RN-CAD-09 (0074): forma de pagamento do tenant ainda sem condição, pelo `external_id` do Hub; null = não existe (ou foi apagada). */
  lerForma(externalId: string): Promise<FormaGuardada | null>;
  /** Grava ou atualiza a forma por (tenant, external_id); `igual` = nada mudou. O reenvio de uma forma apagada a revive. */
  gravarForma(f: FormaParaGravar): Promise<'nova' | 'alterada' | 'igual'>;
  /** LGPD: o lote `recebido` ou `processando` criado antes do `corte` vira `falhou` (`erro_codigo`), com o corpo zerado. Devolve quantos. Idempotente. */
  expurgarCorpos(corte: Date, codigo: string, agora: Date): Promise<number>;
}

/** Forma de pagamento da `cadastros.entrada_forma`; `tpag` nulo = o ERP ainda não sabe o tPag dela. */
export interface FormaGuardada {
  codigo: string;
  nome: string;
  tpag: string | null;
}

/** A forma como o worker a grava: a guardada mais o conector que a enviou, o `external_id` do Hub e o `ativo`. */
export type FormaParaGravar = FormaGuardada & { conector_id: string; external_id: string; ativo: boolean };

type Linha = Record<string, unknown>;

const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export function entradaSql(tx: Transacao): RepositorioEntrada {
  const consultar = <L = Linha>(sql: string, p: readonly unknown[] = []) => tx.consultar<L>(sql, p);
  return {
    async criarLote(p) {
      const novo = await consultar<LoteCriado>(
        `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, conector_id, entidade, modo, idempotency_key, hash_corpo, corpo, recebidos)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (tenant_id, conector_id, idempotency_key) DO NOTHING
         RETURNING id, entidade, modo, recebidos, hash_corpo`,
        [p.credencial_id, p.conector_id, p.entidade, p.modo, p.idempotency_key, p.hash_corpo, JSON.stringify(p.corpo), p.recebidos],
      );
      if (novo[0]) return { lote: novo[0], criado: true };
      const antigo = await consultar<LoteCriado>(
        'SELECT id, entidade, modo, recebidos, hash_corpo FROM cadastros.entrada_lote WHERE conector_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL',
        [p.conector_id, p.idempotency_key],
      );
      if (!antigo[0]) throw new Error('lote da entrada: conflito de idempotência sem a linha existente');
      return { lote: antigo[0], criado: false };
    },

    async lerLote(conectorId, id) {
      const r = await consultar<{
        id: string; entidade: string; modo: ModoLote; estado: LoteGuardado['estado']; contagens: LoteGuardado['contagens']; erros: ErroGuardado[];
        cursor_alterado_em: string | null; cursor_external_id: string | null; recebido_em: string; concluido_em: string | null; erro_codigo: string | null;
      }>(
        `SELECT id, entidade, modo, estado, contagens, erros, erro_codigo, ${ISO('cursor_alterado_em')} AS cursor_alterado_em, cursor_external_id,
                ${ISO('created_at')} AS recebido_em, ${ISO('concluido_em')} AS concluido_em
           FROM cadastros.entrada_lote WHERE id = $1 AND conector_id = $2 AND deleted_at IS NULL`,
        [id, conectorId],
      );
      return r[0] ?? null;
    },

    async lerForma(externalId) {
      const r = await consultar<FormaGuardada>('SELECT codigo, nome, tpag FROM cadastros.entrada_forma WHERE external_id = $1 AND deleted_at IS NULL', [externalId]);
      return r[0] ?? null;
    },

    async gravarForma(f) {
      // O único (tenant_id, external_id) vale também para a linha apagada: o reenvio revive (deleted_at = null). O WHERE do DO UPDATE
      // só deixa passar o que mudou: sem linha devolvida = igual; xmax = 0 = inserida agora.
      const r = await consultar<{ nova: boolean }>(
        `INSERT INTO cadastros.entrada_forma (tenant_id, conector_id, external_id, codigo, nome, tpag, ativo)
         VALUES (plataforma.tenant_atual(), $1::cadastros.entrada_conector_id, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, external_id) DO UPDATE
           SET conector_id = EXCLUDED.conector_id, codigo = EXCLUDED.codigo, nome = EXCLUDED.nome, tpag = EXCLUDED.tpag, ativo = EXCLUDED.ativo,
               deleted_at = NULL, updated_at = now()
           WHERE (cadastros.entrada_forma.codigo, cadastros.entrada_forma.nome, cadastros.entrada_forma.tpag, cadastros.entrada_forma.ativo) IS DISTINCT FROM
                 (EXCLUDED.codigo, EXCLUDED.nome, EXCLUDED.tpag, EXCLUDED.ativo) OR cadastros.entrada_forma.deleted_at IS NOT NULL
         RETURNING (xmax = 0) AS nova`,
        [f.conector_id, f.external_id, f.codigo, f.nome, f.tpag, f.ativo],
      );
      return r[0] ? (r[0].nova ? 'nova' : 'alterada') : 'igual';
    },

    async lerCursor(conectorId, entidade) {
      const r = await consultar<{ alterado_em: string | null; external_id: string | null; atualizado_em: string | null }>(
        `SELECT ${ISO('cursor_alterado_em')} AS alterado_em, cursor_external_id AS external_id, ${ISO('updated_at')} AS atualizado_em
           FROM cadastros.entrada_cursor WHERE conector_id = $1 AND entidade = $2 AND deleted_at IS NULL`,
        [conectorId, entidade],
      );
      const l = r[0];
      if (!l) return null;
      return { cursor: cursorDaLinha(l.alterado_em, l.external_id), atualizado_em: l.atualizado_em };
    },

    async gravarSinal(conectorId, s, agora) {
      await consultar(
        `INSERT INTO cadastros.entrada_sinal (tenant_id, conector_id, ultimo_sinal_em, versao_conector, parado_por_versao)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4)
         ON CONFLICT (tenant_id, conector_id) DO UPDATE
           SET ultimo_sinal_em = EXCLUDED.ultimo_sinal_em, versao_conector = EXCLUDED.versao_conector, parado_por_versao = EXCLUDED.parado_por_versao`,
        [conectorId, agora.toISOString(), s.versao_conector, s.parado_por_versao],
      );
    },

    async proximoDaFila(loteId) {
      const base = await consultar<{ conector_id: string; entidade: string }>('SELECT conector_id, entidade FROM cadastros.entrada_lote WHERE id = $1 AND deleted_at IS NULL', [loteId]);
      const chave = base[0];
      if (!chave) return null;
      // Serializa o conector e a entidade na transação: dois trabalhos do mesmo par nunca processam ao mesmo tempo.
      await consultar('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cadastros.entrada_lote/${chave.conector_id}/${chave.entidade}`]);
      const r = await consultar<LotePendente>(
        `SELECT id, conector_id, entidade, corpo, recebidos FROM cadastros.entrada_lote
          WHERE conector_id = $1 AND entidade = $2 AND estado = 'recebido' AND deleted_at IS NULL
          ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
        [chave.conector_id, chave.entidade],
      );
      return r[0] ?? null;
    },

    async marcarProcessando(id, agora) {
      await consultar("UPDATE cadastros.entrada_lote SET estado = 'processando', processado_em = $2 WHERE id = $1", [id, agora.toISOString()]);
    },

    async concluir(id, r, agora) {
      await consultar(
        `UPDATE cadastros.entrada_lote
            SET estado = $2, com_erro = $3, contagens = $4::jsonb, erros = $5::jsonb, corpo = NULL, concluido_em = $6,
                cursor_alterado_em = $7, cursor_external_id = $8
          WHERE id = $1`,
        [id, r.estado, r.com_erro, JSON.stringify(r.contagens), JSON.stringify(r.erros), agora.toISOString(), r.cursor?.alterado_em ?? null, r.cursor?.external_id ?? null],
      );
    },

    async falhar(id, codigo, agora) {
      await consultar(
        `UPDATE cadastros.entrada_lote SET estado = 'falhou', erro_codigo = $2, corpo = NULL, concluido_em = $3, cursor_alterado_em = NULL, cursor_external_id = NULL
          WHERE id = $1 AND estado IN ('recebido', 'processando')`,
        [id, codigo, agora.toISOString()],
      );
    },

    async expurgarCorpos(corte, codigo, agora) {
      // SKIP LOCKED: o lote que o worker está processando agora (travado) fica para a próxima rodada.
      const r = await consultar(
        `UPDATE cadastros.entrada_lote SET estado = 'falhou', erro_codigo = $2, corpo = NULL, concluido_em = $3, cursor_alterado_em = NULL, cursor_external_id = NULL
          WHERE id IN (SELECT id FROM cadastros.entrada_lote
                        WHERE estado IN ('recebido', 'processando') AND created_at < $1 AND deleted_at IS NULL FOR UPDATE SKIP LOCKED)
          RETURNING id`,
        [corte.toISOString(), codigo, agora.toISOString()],
      );
      return r.length;
    },

    async avancarCursor(conectorId, entidade, cursor, loteId) {
      await consultar(
        `INSERT INTO cadastros.entrada_cursor (tenant_id, conector_id, entidade, cursor_alterado_em, cursor_external_id, ultimo_lote_id)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, conector_id, entidade) DO UPDATE
           SET cursor_alterado_em = EXCLUDED.cursor_alterado_em, cursor_external_id = EXCLUDED.cursor_external_id, ultimo_lote_id = EXCLUDED.ultimo_lote_id
         WHERE entrada_cursor.cursor_alterado_em IS NULL
            OR (entrada_cursor.cursor_alterado_em, entrada_cursor.cursor_external_id) < (EXCLUDED.cursor_alterado_em, EXCLUDED.cursor_external_id)`,
        [conectorId, entidade, cursor.alterado_em, cursor.external_id, loteId],
      );
    },
  };
}
