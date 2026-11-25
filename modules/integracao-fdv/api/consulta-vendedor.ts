/**
 * Porta `ConsultaVendedorFdv` (T-0105): confere o vendedor no espelho `integracao_fdv.registro_publicado` pela chave do Hub.
 * Lê só o schema do próprio módulo, na transação do tenant, com `tenant_id` explícito (e RLS). Sem rede, sem escrita.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { ConsultaVendedorFdv, VendedorNoEspelhoFdv } from '../contracts';

interface LinhaVendedor {
  registro_external_id: string;
  erp_id: string | null;
  ativo: boolean;
  nome: unknown;
}

export function criarConsultaVendedorFdv(): ConsultaVendedorFdv {
  return {
    async vendedorPorExternalId(tx: Transacao, tenant: string, externalId: string): Promise<VendedorNoEspelhoFdv | null> {
      const [l] = await tx.consultar<LinhaVendedor>(
        `SELECT registro_external_id, erp_id, ativo, payload ->> 'nome' AS nome
           FROM integracao_fdv.registro_publicado
          WHERE tenant_id = $1 AND entidade = 'vendedor' AND registro_external_id = $2 AND deleted_at IS NULL`,
        [tenant, externalId],
      );
      if (!l) return null;
      const v: VendedorNoEspelhoFdv = { external_id: l.registro_external_id, ativo: l.ativo };
      if (l.erp_id) v.vendedor_id = l.erp_id;
      if (typeof l.nome === 'string' && l.nome !== '') v.nome = l.nome;
      return v;
    },
  };
}
