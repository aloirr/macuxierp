/**
 * Adaptador PostgreSQL da fila de descida (ADR 0014 §8 e §13). Tabela `pedido.descida_pedido` da migração 0045 do banco-dados
 * (premissa de nome e colunas: `pedido_id` único, `pedido_uuid`, `enfileirado_em`, `descido_em`, mais a regra 5 do CLAUDE.md).
 * Roda na transação do tenant (RLS por `app.tenant_id`): o SQL não repete `tenant_id` no WHERE.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { NotaReferenciaCliente } from '../contracts';
import { STATUS_DESCEM } from '../domain';
import type { FilaDescida, LinhaDescida } from './descida';

const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const COLUNAS = `d.pedido_id, d.pedido_uuid, ${ISO('d.enfileirado_em')} AS enfileirado_em, ${ISO('d.descido_em')} AS descido_em`;
const DESCEM = STATUS_DESCEM.map((s) => `'${s}'`).join(', ');

class FilaDescidaSql implements FilaDescida {
  constructor(private readonly tx: Transacao) {}

  async enfileirar(pedidoId: string, pedidoUuid: string, quando: Date): Promise<boolean> {
    const l = await this.tx.consultar<{ id: string }>(
      `INSERT INTO pedido.descida_pedido (tenant_id, pedido_id, pedido_uuid, enfileirado_em)
       VALUES (plataforma.tenant_atual(), $1, $2, $3)
       ON CONFLICT (tenant_id, pedido_id) DO NOTHING RETURNING id`,
      [pedidoId, pedidoUuid, quando.toISOString()],
    );
    return l.length > 0;
  }

  async obter(pedidoId: string): Promise<LinhaDescida | null> {
    const l = await this.tx.consultar<LinhaDescida>(`SELECT ${COLUNAS} FROM pedido.descida_pedido d WHERE d.pedido_id = $1 AND d.deleted_at IS NULL`, [pedidoId]);
    return l[0] ?? null;
  }

  async pendentes(limite: number): Promise<LinhaDescida[]> {
    return this.tx.consultar<LinhaDescida>(
      `SELECT ${COLUNAS}
         FROM pedido.descida_pedido d JOIN pedido.pedido p ON p.tenant_id = d.tenant_id AND p.id = d.pedido_id
        WHERE d.descido_em IS NULL AND d.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN (${DESCEM})
        ORDER BY d.enfileirado_em, d.pedido_id LIMIT $1`,
      [limite],
    );
  }

  async marcarDescido(pedidoId: string, quando: Date): Promise<boolean> {
    const l = await this.tx.consultar<{ id: string }>(
      'UPDATE pedido.descida_pedido SET descido_em = $2 WHERE pedido_id = $1 AND descido_em IS NULL AND deleted_at IS NULL RETURNING id',
      [pedidoId, quando.toISOString()],
    );
    return l.length > 0;
  }

  async notaCliente(pedidoId: string): Promise<NotaReferenciaCliente | null> {
    const l = await this.tx.consultar<{ numero: number | null; serie: number | null; emitida_em: string | null; total_centavos: number | null }>(
      `SELECT nota_cliente_numero AS numero, nota_cliente_serie AS serie, ${ISO('nota_cliente_emitida_em')} AS emitida_em, nota_cliente_total_centavos::float8 AS total_centavos
         FROM pedido.pedido WHERE id = $1 AND deleted_at IS NULL`,
      [pedidoId],
    );
    const n = l[0];
    return n && n.numero !== null && n.serie !== null && n.emitida_em !== null && n.total_centavos !== null
      ? { numero: n.numero, serie: n.serie, emitida_em: n.emitida_em, total_centavos: n.total_centavos }
      : null;
  }

  async gravarNotaCliente(pedidoId: string, nota: NotaReferenciaCliente): Promise<void> {
    await this.tx.consultar(
      `UPDATE pedido.pedido SET nota_cliente_numero = $2, nota_cliente_serie = $3, nota_cliente_emitida_em = $4, nota_cliente_total_centavos = $5
        WHERE id = $1 AND deleted_at IS NULL`,
      [pedidoId, nota.numero, nota.serie, nota.emitida_em, nota.total_centavos],
    );
  }
}

export const filaDescidaSql = (tx: Transacao): FilaDescida => new FilaDescidaSql(tx);
