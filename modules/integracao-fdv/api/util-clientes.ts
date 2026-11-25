import type { Transacao } from '@macuxierp/platform-sdk';

/** Agenda o envio dos retornos de pré-cadastro para já (`least`), sem atrasar uma agenda mais próxima. */
export async function agendarRetornoCliente(tx: Transacao, tenantId: string, agora: Date): Promise<void> {
  await tx.consultar(
    `UPDATE integracao_fdv.sinal SET proximo_retorno_clientes_em = least(coalesce(proximo_retorno_clientes_em, $2), $2)
      WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId, agora],
  );
}
