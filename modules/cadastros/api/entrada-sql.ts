/**
 * T-0057 C3/C4: porta e adaptador SQL das tabelas da entrada (0071): lote, cursor e sinal. A API (papel `macuxierp_app`) cria o
 * lote, lê o resultado e o cursor e grava o sinal; o worker (`macuxierp_worker`) pega o lote da fila, grava o resultado e avança
 * o cursor. O `tenant_id` vem sempre da transação (`plataforma.tenant_atual()`, RLS). Nunca guarda nem devolve o dado dos registros
 * depois do estado final: o `corpo` é zerado e os erros levam só índice, `external_id`, campo e código (LGPD).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { CorpoLote, CursorHub } from '@macuxierp/platform-sdk/hub-v1';
import type { ErroGuardado, LoteGuardado } from '../domain';

export interface LoteCriado {
  id: string;
  entidade: string;
  modo: 'completo' | 'delta';
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
  estado: 'concluido' | 'concluido_com_erros';
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
    credencial_id: string; conector_id: string; entidade: string; modo: 'completo' | 'delta'; idempotency_key: string; hash_corpo: string;
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
}

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
        id: string; entidade: string; modo: 'completo' | 'delta'; estado: LoteGuardado['estado']; contagens: LoteGuardado['contagens']; erros: ErroGuardado[];
        cursor_alterado_em: string | null; cursor_external_id: string | null; recebido_em: string; concluido_em: string | null; erro_codigo: string | null;
      }>(
        `SELECT id, entidade, modo, estado, contagens, erros, erro_codigo, ${ISO('cursor_alterado_em')} AS cursor_alterado_em, cursor_external_id,
                ${ISO('created_at')} AS recebido_em, ${ISO('concluido_em')} AS concluido_em
           FROM cadastros.entrada_lote WHERE id = $1 AND conector_id = $2 AND deleted_at IS NULL`,
        [id, conectorId],
      );
      return r[0] ?? null;
    },

    async lerCursor(conectorId, entidade) {
      const r = await consultar<{ alterado_em: string | null; external_id: string | null; atualizado_em: string | null }>(
        `SELECT ${ISO('cursor_alterado_em')} AS alterado_em, cursor_external_id AS external_id, ${ISO('updated_at')} AS atualizado_em
           FROM cadastros.entrada_cursor WHERE conector_id = $1 AND entidade = $2 AND deleted_at IS NULL`,
        [conectorId, entidade],
      );
      const l = r[0];
      if (!l) return null;
      return { cursor: l.alterado_em !== null && l.external_id !== null ? { alterado_em: l.alterado_em, external_id: l.external_id } : null, atualizado_em: l.atualizado_em };
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
