/**
 * Leitura do `GET /v1/integracao-fdv/status` (ADR 0013 seção 6; RF-INF-04): só leitura, pela RLS do tenant, só colunas nomeadas.
 * A precedência da falha e o "ligada" saem do domain (`montarStatusTenant`). Nada editável nem o id da credencial vão à resposta.
 */
import type { StatusIntegracaoFdvTenant, Transacao } from '@macuxierp/platform-sdk';
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import { montarStatusTenant, type CursorStatus } from '../domain';
import { lerCredencialResumo, lerSinalPublico } from './monitor';

const F2 = ENTIDADES_ENVIO_FDV as readonly string[];

export async function lerStatus(tx: Transacao, tenantId: string): Promise<StatusIntegracaoFdvTenant> {
  const credencial = await lerCredencialResumo(tx, tenantId);
  const cursores = await tx.consultar<{ entidade: string; pausada_motivo: MotivoPausa | null }>(
    `SELECT entidade::text AS entidade, pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  // último envio = o maior `enviado_em` dos lotes do cadastro; estado = o do lote mais novo
  const lotes = await tx.consultar<{ entidade: string; ultimo_envio_em: Date | null; ultimo_lote_estado: string }>(
    `SELECT DISTINCT ON (entidade) entidade::text AS entidade, max(enviado_em) OVER (PARTITION BY entidade) AS ultimo_envio_em, estado AS ultimo_lote_estado
       FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY entidade, created_at DESC, id DESC`,
    [tenantId],
  );
  const abertos = await tx.consultar<{ entidade: string; n: number }>(
    `SELECT entidade::text AS entidade, count(*)::int AS n FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND resolvido_em IS NULL AND deleted_at IS NULL GROUP BY entidade`,
    [tenantId],
  );
  const cur = new Map(cursores.map((c) => [c.entidade, c]));
  const lot = new Map(lotes.map((l) => [l.entidade, l]));
  const abe = new Map(abertos.map((a) => [a.entidade, a.n]));
  const itens: CursorStatus[] = F2.map((entidade) => ({
    entidade: entidade as CursorStatus['entidade'],
    ultimo_envio_em: lot.get(entidade)?.ultimo_envio_em?.toISOString() ?? null,
    pausada_motivo: cur.get(entidade)?.pausada_motivo ?? null,
    ultimo_lote_estado: lot.get(entidade)?.ultimo_lote_estado ?? null,
    erros_abertos: abe.get(entidade) ?? 0,
  }));
  return montarStatusTenant(
    credencial && { conector_id: credencial.conector_id, ambiente: credencial.ambiente, chave_prefixo: credencial.chave_prefixo, entidades_habilitadas: credencial.entidades_habilitadas },
    itens,
    await lerSinalPublico(tx, tenantId),
  );
}
