/**
 * RN-CORE-14 (T-0100, docs/desenho/T-0100.md): `cadastros.filial.alterada@1` cria a `core.empresa` do tenant a partir da
 * primeira filial padrão viva. Só cria, nunca atualiza.
 * - Leitor tolerante (Zod local, só os campos de `FilialParaEmpresa` e o `id`), sem importar o cadastros. Payload inválido é ignorado.
 * - Idempotência: `INSERT ... ON CONFLICT (tenant_id) DO NOTHING` (UNIQUE da 0003, que não olha `deleted_at`: empresa
 *   excluída continua bloqueando). Auditoria e `core.empresa.alterada@1` só saem quando a linha foi de fato criada.
 * - `fuso`: o padrão da coluna (o consumidor não recebe o fuso do tenant).
 */
import { auditar, criarEvento, type ConsumidorEvento, type DestinoAuditoria, type Outbox } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { EVENTO_EMPRESA } from '../contracts';
import { empresaDaFilialPadrao, type FilialParaEmpresa } from '../domain';

export const EVENTO_FILIAL_ALTERADA = 'cadastros.filial.alterada@1';
export const ID_CONSUMIDOR_EMPRESA_DA_FILIAL = 'core.empresa-da-filial-padrao';

const FilialLida = z.object({
  id: z.string().uuid(),
  padrao: z.boolean().catch(false),
  inativo: z.boolean().nullish().catch(undefined),
  cnpj: z.string().nullish().catch(undefined),
  razao_social: z.string().nullish().catch(undefined),
  nome_fantasia: z.string().nullish().catch(undefined),
  ie: z.string().nullish().catch(undefined),
}) satisfies z.ZodType<FilialParaEmpresa & { id: string }, z.ZodTypeDef, unknown>;

interface LinhaCriada {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ie: string | null;
  fuso: string;
  updated_at: Date;
}

export function criarConsumidorEmpresaDaFilial(deps: { outbox: Outbox; auditoria: DestinoAuditoria; agora?: () => Date }): ConsumidorEvento {
  return {
    id: ID_CONSUMIDOR_EMPRESA_DA_FILIAL,
    eventos: [EVENTO_FILIAL_ALTERADA],
    async tratar(evento, tx) {
      const lida = FilialLida.safeParse(evento.payload);
      if (!lida.success) return;
      const filial = lida.data;
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM core.empresa');
      const dados = empresaDaFilialPadrao(filial, existente !== undefined);
      if (!dados) return;
      const [criada] = await tx.consultar<LinhaCriada>(
        `INSERT INTO core.empresa (tenant_id, razao_social, nome_fantasia, cnpj, ie)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO NOTHING
         RETURNING id, razao_social, nome_fantasia, cnpj::text AS cnpj, ie, fuso, updated_at`,
        [evento.tenant_id, dados.razao_social, dados.nome_fantasia, dados.cnpj, dados.ie],
      );
      if (!criada) return; // corrida com o backfill ou com outro evento: nada a fazer
      const agora = (deps.agora ?? (() => new Date()))();
      const depois = {
        id: criada.id, razao_social: criada.razao_social, nome_fantasia: criada.nome_fantasia,
        cnpj: criada.cnpj, ie: criada.ie, fuso: criada.fuso, updated_at: criada.updated_at.toISOString(),
      };
      await auditar(
        deps.auditoria, tx,
        { tenant_id: evento.tenant_id, usuario_id: null, request_id: evento.request_id },
        { acao: 'core.empresa.criada', entidade: 'empresa', entidade_id: criada.id, depois: { ...depois, origem: 'filial_padrao', filial_id: filial.id } },
        agora,
      );
      await deps.outbox.gravar(tx, criarEvento(
        { nome: EVENTO_EMPRESA, tenant_id: evento.tenant_id, agregado_id: evento.tenant_id, versao: 1, ator: 'sistema', request_id: evento.request_id, payload: depois },
        agora,
      ));
    },
  };
}
