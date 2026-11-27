/**
 * Porta `ConsultaNfeProducao` (RN-CORE-16): o `core` pergunta se a empresa tem NF-e autorizada em produção, para travar a troca do CNPJ.
 * Lê `faturamento.nota` na transação do tenant (RLS): nunca vê nota de outro tenant. Só leitura; não toca nota, XML nem evento.
 * A apps/api liga com o `BancoPg` da aplicação.
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import type { ConsultaNfeProducao } from '../contracts';
import { STATUS_NFE_AUTORIZADA_EM_PRODUCAO } from '../domain';

export function criarConsultaNfeProducao(banco: Pick<BancoPg, 'comTenant'>): ConsultaNfeProducao {
  return {
    temNfeAutorizadaEmProducao: (tenant_id) =>
      banco.comTenant(tenant_id, async (tx) => {
        const [l] = await tx.consultar<{ existe: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM faturamento.nota WHERE ambiente = 'producao' AND status = ANY($1::text[]) AND deleted_at IS NULL) AS existe`,
          [[...STATUS_NFE_AUTORIZADA_EM_PRODUCAO]],
        );
        return l?.existe === true;
      }),
  };
}
