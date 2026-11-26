/**
 * T-0108, RN-CAD-15 (decisão 14 A): completa o prazo médio das condições JÁ gravadas com ele vazio (`completarPrazoMedio`).
 * `completarPrazosMedios(deps)(tx, tenant)` roda na transação do tenant; seleciona as ativas com prazo médio nulo (`FOR UPDATE`),
 * grava pelo mesmo repositório do PATCH, emite o mesmo evento e faz UMA auditoria por tenant só com a quantidade (nenhuma se n = 0).
 * Idempotente.
 */
import { auditar, criarEvento, type DestinoAuditoria, type Outbox, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { completarPrazoMedio } from '../domain';
import { eventoSimples } from './eventos';
import type { Dependencias } from './portas';

export interface DependenciasCompletarPrazosMedios {
  repositorios: Dependencias['repositorios'];
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  relogio: Relogio;
}

export function completarPrazosMedios(d: DependenciasCompletarPrazosMedios) {
  return async (tx: Transacao, tenant: string): Promise<{ completadas: number }> => {
    const r = d.repositorios(tx);
    const agora = d.relogio.agora();
    const requestId = `completar-prazos-medios-${tenant}`;
    let completadas = 0;
    for (const c of await r.carga.condicoesAtivasSemPrazoMedio()) {
      const { prazo_medio_dias, prazo_medio_calculado } = completarPrazoMedio({ prazo_medio_dias: null }, c);
      if (prazo_medio_calculado !== true) continue;
      const depois = await r.condicoesPagamento.atualizar(c.id, { prazo_medio_dias, prazo_medio_calculado } as never);
      if (!depois) continue;
      const ev = eventoSimples('cadastros.condicao_pagamento.alterada@1', depois);
      await d.outbox.gravar(tx, criarEvento({ nome: ev.nome, tenant_id: tenant, agregado_id: ev.agregado_id, ator: 'sistema', request_id: requestId, payload: ev.payload }, agora));
      completadas += 1;
    }
    if (completadas > 0) {
      await auditar(d.auditoria, tx, { tenant_id: tenant, usuario_id: null, request_id: requestId }, {
        acao: 'condicao_pagamento.completar_prazos_medios', entidade: 'condicao_pagamento', entidade_id: tenant, depois: { completadas },
      }, agora);
    }
    return { completadas };
  };
}
