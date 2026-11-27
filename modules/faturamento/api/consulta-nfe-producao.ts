/**
 * Implementa a porta `ConsultaNfeProducao` do core (RN-CORE-16, definida em modules/core/api): o `core` pergunta se a empresa tem NF-e autorizada em produção, para travar a troca do CNPJ.
 * Lê `faturamento.nota` na transação do tenant (RLS): nunca vê nota de outro tenant. Só leitura; não toca nota, XML nem evento.
 * A apps/api liga com o `Banco` da aplicação.
 */
import type { Banco } from '@macuxierp/platform-sdk';
import { STATUS_NFE_QUE_TRAVA_TROCA_CNPJ } from '../domain';

/**
 * Mesma forma da porta `ConsultaNfeProducao` do core (modules/core/api); o TypeScript compara pela forma, sem importar.
 * O nome `temNfeAutorizadaEmProducao` é do core; os status que contam estão em `domain/nfe-producao.ts`.
 */
type PortaConsultaNfeProducao = { temNfeAutorizadaEmProducao(tenantId: string): Promise<boolean> };

export function criarConsultaNfeProducao(banco: Pick<Banco, 'comTenant'>): PortaConsultaNfeProducao {
  return {
    temNfeAutorizadaEmProducao: (tenantId) =>
      banco.comTenant(tenantId, async (tx) => {
        const [l] = await tx.consultar<{ existe: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM faturamento.nota WHERE ambiente = 'producao' AND status = ANY($1::text[]) AND deleted_at IS NULL) AS existe`,
          [[...STATUS_NFE_QUE_TRAVA_TROCA_CNPJ]],
        );
        return l?.existe === true;
      }),
  };
}
