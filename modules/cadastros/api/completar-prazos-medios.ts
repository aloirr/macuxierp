/**
 * T-0108, decisões 14 A e 17 B (Alexandre, R-20261125-154127): completa o prazo médio das condições JÁ gravadas com ele vazio.
 * `completarPrazosMedios(deps)(tx, tenant)` roda na transação do tenant (quem chama, worker ou deploy, abre a transação):
 * - seleciona as condições ativas (não excluídas) com `prazo_medio_dias` nulo e ao menos uma parcela, com `FOR UPDATE`;
 * - grava `prazoMedioEfetivo` e a marca `prazo_medio_calculado = true` pelo mesmo repositório do PATCH e emite o mesmo evento (`eventoSimples`, `cadastros.condicao_pagamento.alterada@1`);
 * - UMA auditoria por tenant, só com a quantidade (`{ completadas: n }`), sem código nem descrição; com n = 0 não grava nada.
 * Idempotente: a segunda rodada não acha mais condição vazia.
 */
import { auditar, criarEvento, type DestinoAuditoria, type Outbox, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { prazoMedioEfetivo } from '../domain';
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
      const efetivo = prazoMedioEfetivo(c.prazos_dias, null);
      if (efetivo === null) continue;
      const depois = await r.condicoesPagamento.atualizar(c.id, { prazo_medio_dias: efetivo, prazo_medio_calculado: true } as never);
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
