/**
 * Portas do worker no PostgreSQL (`plataforma.evento`, `evento_consumido` e `trabalho`; D10; reentrega da partida, T-0045). A reserva roda em
 * `banco.semTenant` no papel `macuxierp_worker` (política `worker_global`: enxerga a fila de todos os tenants) e trava as
 * linhas até o fim da transação do lote. A trava é `FOR NO KEY UPDATE`, não `FOR UPDATE`: o consumidor grava
 * `evento_consumido` (FK para o evento, que pede `KEY SHARE`) noutra transação enquanto a do lote segue aberta, e o
 * `FOR UPDATE` faria uma esperar pela outra para sempre.
 */
import type { EnvelopeEvento, Trabalho, Transacao } from '@macuxierp/platform-sdk';
import { envelopeDaLinha, SELECT_EVENTO, type LinhaEvento } from '@macuxierp/platform-sdk/pg';
import type { EventoPendente, FilaOutbox, FonteReentrega, RegistroConsumo, ReservaTrabalhos } from './portas';

/** Trava consultiva da outbox: um despachante por vez mantém a ordem por agregado (outro worker sai com lote vazio). */
const TRAVA_OUTBOX = 7_302_101;

export class FilaOutboxPg implements FilaOutbox {
  async reservar(tx: Transacao, limite: number, agora: Date): Promise<EventoPendente[]> {
    const [trava] = await tx.consultar<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [TRAVA_OUTBOX]);
    if (!trava?.ok) return [];
    // Fica de fora o evento com outro anterior do mesmo agregado ainda à espera do backoff; o anterior elegível vem no
    // mesmo lote, na frente (ordem de ocorrido_em e versão).
    const linhas = await tx.consultar<LinhaEvento & { tentativas: number }>(
      `SELECT ${SELECT_EVENTO}, tentativas FROM plataforma.evento e
       WHERE e.publicado_em IS NULL AND e.proximo_em <= $2
         AND NOT EXISTS (
           SELECT 1 FROM plataforma.evento a
           WHERE a.tenant_id = e.tenant_id AND a.agregado_id = e.agregado_id AND a.publicado_em IS NULL
             AND a.proximo_em > $2 AND (a.ocorrido_em, a.versao) < (e.ocorrido_em, e.versao))
       ORDER BY e.ocorrido_em, e.versao, e.id
       LIMIT $1
       FOR NO KEY UPDATE SKIP LOCKED`,
      [limite, agora],
    );
    return linhas.map((l) => ({ ...envelopeDaLinha(l), tentativas: l.tentativas }));
  }

  async marcarPublicado(tx: Transacao, id: string, agora: Date): Promise<void> {
    await tx.consultar('UPDATE plataforma.evento SET publicado_em = $2, erro = NULL WHERE id = $1', [id, agora]);
  }

  async marcarFalha(tx: Transacao, id: string, tentativas: number, proximoEm: Date, erro: string): Promise<void> {
    await tx.consultar('UPDATE plataforma.evento SET tentativas = $2, proximo_em = $3, erro = $4 WHERE id = $1', [id, tentativas, proximoEm, erro]);
  }

  async marcarFalhou(tx: Transacao, id: string, tentativas: number, agora: Date, erro: string): Promise<void> {
    await tx.consultar('UPDATE plataforma.evento SET publicado_em = $3, tentativas = $2, erro = $4 WHERE id = $1', [id, tentativas, agora, erro]);
  }
}

/** Reentrega da partida (T-0045): só `plataforma.evento` e `plataforma.evento_consumido`. */
export class FonteReentregaPg implements FonteReentrega {
  async pendentes(tx: Transacao, consumidor: string, nome: string, ignorar: readonly string[], limite: number): Promise<EnvelopeEvento[]> {
    const linhas = await tx.consultar<LinhaEvento>(
      `SELECT ${SELECT_EVENTO} FROM plataforma.evento e
       WHERE e.nome = $2 AND e.publicado_em IS NOT NULL AND e.erro IS NULL AND NOT (e.id = ANY($3::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM plataforma.evento_consumido c WHERE c.consumidor = $1 AND c.evento_id = e.id)
       ORDER BY e.ocorrido_em, e.versao, e.id
       LIMIT $4`,
      [consumidor, nome, ignorar, limite],
    );
    return linhas.map(envelopeDaLinha);
  }
}

export class RegistroConsumoPg implements RegistroConsumo {
  async jaConsumido(tx: Transacao, consumidor: string, eventoId: string): Promise<boolean> {
    const linhas = await tx.consultar('SELECT 1 FROM plataforma.evento_consumido WHERE consumidor = $1 AND evento_id = $2', [consumidor, eventoId]);
    return linhas.length > 0;
  }

  /** Na transação do tenant do evento (`tenant_atual()`), junto com o efeito do consumidor. */
  async registrar(tx: Transacao, consumidor: string, eventoId: string, agora: Date): Promise<void> {
    await tx.consultar(
      'INSERT INTO plataforma.evento_consumido (tenant_id, consumidor, evento_id, created_at) VALUES (plataforma.tenant_atual(), $1, $2, $3)',
      [consumidor, eventoId, agora],
    );
  }
}

export class ReservaTrabalhosPg implements ReservaTrabalhos {
  async reservar(tx: Transacao, tipos: readonly string[], limite: number, agora: Date): Promise<Trabalho[]> {
    return tx.consultar<Trabalho>(
      `SELECT id, tipo, tenant_id, payload, tentativas FROM plataforma.trabalho
       WHERE estado = 'pendente' AND tipo = ANY($1::text[]) AND proximo_em <= $3
       ORDER BY proximo_em, id
       LIMIT $2
       FOR NO KEY UPDATE SKIP LOCKED`,
      [tipos, limite, agora],
    );
  }

  async concluir(tx: Transacao, id: string, resultado: Record<string, unknown> | null): Promise<void> {
    await tx.consultar("UPDATE plataforma.trabalho SET estado = 'concluido', resultado = $2, erro = NULL WHERE id = $1", [id, resultado]);
  }

  async falhar(tx: Transacao, id: string, tentativas: number, proximoEm: Date | null, erro: string): Promise<void> {
    await tx.consultar(
      `UPDATE plataforma.trabalho
       SET tentativas = $2, erro = $4, estado = CASE WHEN $3::timestamptz IS NULL THEN 'falhou' ELSE 'pendente' END,
           proximo_em = coalesce($3, proximo_em)
       WHERE id = $1`,
      [id, tentativas, proximoEm, erro],
    );
  }
}
