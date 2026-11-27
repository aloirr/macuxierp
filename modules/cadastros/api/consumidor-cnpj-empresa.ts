/**
 * RN-CORE-14 e RN-CORE-16 (v0.3.24): `core.empresa.cnpj_alterado@1` leva o novo CNPJ da empresa à filial padrão viva do tenant.
 * Mesmo id e mesmo external_id; só o CNPJ muda. Roda no worker, na transação do tenant do evento (a plataforma deduplica por consumidor).
 * - A decisão é do domain (`precisaGravarCnpjDaFilialPadrao`): CNPJ já igual = nada é gravado, auditado nem emitido (idempotente).
 * - Sem filial padrão viva: `warn` só com o tenant_id. CNPJ repetido em outra filial: o erro do banco sobe (o evento falha e é reprocessado).
 * - Auditoria `filial.atualizar` sem o valor do CNPJ; evento `cadastros.filial.alterada@1` pelo mesmo `eventoFilial` do PATCH.
 * - O "código" da filial no FDV é a ordem do CNPJ, derivada pela integração a partir do evento; não há coluna de código aqui.
 */
import { auditar, Cnpj, type ConsumidorEvento, type DestinoAuditoria, type Outbox, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { precisaGravarCnpjDaFilialPadrao } from '../domain';
import { eventoFilial, gravarProntoNaOutbox } from './eventos';
import type { Repositorios } from './portas';

export const EVENTO_EMPRESA_CNPJ_ALTERADO = 'core.empresa.cnpj_alterado@1';

// TODO(core-contract): trocar pelo Zod de modules/core/contracts quando o PR do core (nuvem/v0324-core-ficha-editavel) existir.
const CnpjAlteradoLido = z.object({ cnpj_novo: Cnpj }).passthrough();

export interface DependenciasConsumidorCnpjEmpresa {
  repositorios(tx: Transacao): Repositorios;
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  agora?: () => Date;
  log?: { warn: (o: Record<string, unknown>, msg: string) => void };
}

export function criarConsumidorCnpjEmpresa(d: DependenciasConsumidorCnpjEmpresa): ConsumidorEvento {
  return {
    id: 'cadastros.cnpj-empresa',
    eventos: [EVENTO_EMPRESA_CNPJ_ALTERADO],
    async tratar(evento, tx) {
      const lido = CnpjAlteradoLido.safeParse(evento.payload);
      if (!lido.success) {
        d.log?.warn({ tenant_id: evento.tenant_id, motivo: 'payload_invalido' }, 'cadastros.cnpj-empresa: payload inválido ignorado');
        return;
      }
      const tenant = evento.tenant_id;
      const r = d.repositorios(tx);
      const filial = await r.filiais.padrao();
      if (!filial || filial.inativo) {
        d.log?.warn({ tenant_id: tenant }, 'cadastros.cnpj-empresa: tenant sem filial padrão, CNPJ não propagado');
        return;
      }
      if (!precisaGravarCnpjDaFilialPadrao(filial.cnpj, lido.data.cnpj_novo)) return;
      const gravada = await r.filiais.atualizar(filial.id, { cnpj: lido.data.cnpj_novo });
      if (!gravada) return;
      const agora = (d.agora ?? (() => new Date()))();
      await auditar(d.auditoria, tx, { tenant_id: tenant, usuario_id: null, request_id: evento.request_id }, {
        acao: 'filial.atualizar', entidade: 'filial', entidade_id: gravada.id, depois: { origem: 'troca_cnpj_empresa', campos: ['cnpj'] },
      }, agora);
      const ev = await eventoFilial(r, gravada);
      await gravarProntoNaOutbox(d.outbox, tx, evento, ev, agora);
    },
  };
}
