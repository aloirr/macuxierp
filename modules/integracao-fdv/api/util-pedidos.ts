import { sha256Hex, type Transacao } from '@macuxierp/platform-sdk';
import { RetornoErp as RetornoErpSchema, type RetornoErp } from '../contracts';
import { corpoCanonicoDoRetorno } from '../domain/retorno-pedido';

/** SHA-256 do JSON canônico do corpo sem `ocorrido_em` (T-0013 §6.3): o mesmo efeito não vira dois retornos. */
export const hashDoRetorno = (corpo: RetornoErp): string => sha256Hex(corpoCanonicoDoRetorno(corpo));

/** Agenda o envio de retornos para já (`least`), sem atrasar uma agenda mais próxima. */
export async function agendarRetorno(tx: Transacao, tenantId: string, agora: Date): Promise<void> {
  await tx.consultar(
    `UPDATE integracao_fdv.sinal SET proximo_retorno_em = least(coalesce(proximo_retorno_em, $2), $2), updated_at = now()
      WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId, agora],
  );
}

/** Grava o retorno de forma idempotente (RN-PED-05; `UNIQUE (tenant_id, pedido_uuid, status, hash)`). Devolve se criou. */
export async function gravarRetorno(tx: Transacao, tenantId: string, bruto: RetornoErp, agora: Date): Promise<boolean> {
  const corpo = RetornoErpSchema.parse(bruto); // falha alto: corpo inválido nunca vai à fila
  const linhas = await tx.consultar<{ id: string }>(
    `INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (tenant_id, pedido_uuid, status, hash) DO NOTHING RETURNING id`,
    [tenantId, corpo.pedido_uuid, corpo.status, corpo.numero_erp ?? null, JSON.stringify(corpo), hashDoRetorno(corpo)],
  );
  await agendarRetorno(tx, tenantId, agora);
  return linhas.length > 0;
}

/** Código do Hub só se for identificador (o campo vai ao monitor); senão, `desconhecido`. */
export const codigoSeguro = (c: string | undefined): string => (c && /^[a-z][a-z0-9_]{0,59}$/.test(c) ? c : 'desconhecido');

/** 401/403/426 do Hub: a credencial do conector foi recusada e o conector pausa. */
export const credencialRecusada = (status: number): boolean => status === 401 || status === 403 || status === 426;
