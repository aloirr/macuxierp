/**
 * Agenda do conector nativo do Hub do FDV (contrato C-9, T-0009 seção 6.1): `reservar` (sem tenant, `worker_global`),
 * `executar` (envio por entidade, sinal e reconciliação) e `semLicenca`. O laço é do `apps/worker`.
 *
 * Reserva: linhas vencidas e não pausadas de `cursor_entidade` (tarefa `envio`, chave = entidade) e de `sinal`
 * (`proximo_sinal_em` → `sinal`; `proxima_reconciliacao_em` → `reconciliacao`), com `FOR NO KEY UPDATE SKIP LOCKED`, adiando a
 * coluna para `posseAte` na mesma transação. NÃO mexe em `proxima_busca_pedidos_em` nem em `proximo_retorno_em` (agenda da
 * T-0016). A ordem é sinal, reconciliação, envio, cada um com a cota de `repartirLimiteAgenda` (o sinal, uma linha por tenant
 * vencendo a cada minuto, não ocupa o limite todo; o que sobrar vai para o envio). Em `semTenant` o papel do worker enxerga todos os tenants: é a única consulta sem `tenant_id` do módulo.
 */
import type { AgendaModulo, ItemAgenda, Transacao } from '@macuxierp/platform-sdk';
import { proximaReconciliacaoEm, repartirLimiteAgenda } from '../domain';
import { UMA_HORA_S, mais, type DepsAgendaConector } from './conector-comum';
import { executarEnvio } from './envio-lote';
import { executarReconciliacao, executarSinal } from './sinal-conector';

export type { DepsAgendaConector };

export const AGENDA_CONECTOR_ID = 'integracao-fdv.conector';

async function reservarEnvios(tx: Transacao, limite: number, agora: Date, posseAte: Date): Promise<ItemAgenda[]> {
  const l = await tx.consultar<{ tenant_id: string; entidade: string }>(
    `WITH v AS (
       SELECT id FROM integracao_fdv.cursor_entidade
        WHERE proximo_em <= $1 AND pausada_motivo IS NULL AND deleted_at IS NULL
        ORDER BY proximo_em LIMIT $2 FOR NO KEY UPDATE SKIP LOCKED)
     UPDATE integracao_fdv.cursor_entidade c SET proximo_em = $3, updated_at = now()
       FROM v WHERE c.id = v.id RETURNING c.tenant_id, c.entidade::text AS entidade`,
    [agora, limite, posseAte],
  );
  return l.map((x) => ({ tenant_id: x.tenant_id, tarefa: 'envio', chave: x.entidade }));
}

async function reservarSinal(tx: Transacao, coluna: 'proximo_sinal_em' | 'proxima_reconciliacao_em', limite: number, agora: Date, posseAte: Date): Promise<ItemAgenda[]> {
  const sql = `WITH v AS (
       SELECT id FROM integracao_fdv.sinal WHERE ${coluna} <= $1 AND deleted_at IS NULL ORDER BY ${coluna} LIMIT $2 FOR NO KEY UPDATE SKIP LOCKED)
     UPDATE integracao_fdv.sinal s SET ${coluna} = $3, updated_at = now() FROM v WHERE s.id = v.id RETURNING s.tenant_id`;
  const l = await tx.consultar<{ tenant_id: string }>(sql, [agora, limite, posseAte]);
  return l.map((x) => ({ tenant_id: x.tenant_id, tarefa: coluna === 'proximo_sinal_em' ? 'sinal' : 'reconciliacao', chave: null }));
}

export function criarAgendaConector(deps: DepsAgendaConector): AgendaModulo {
  return {
    id: AGENDA_CONECTOR_ID,
    modulo: 'integracao-fdv',
    async reservar(tx, limite, agora, posseAte) {
      const cotas = repartirLimiteAgenda(limite);
      const itens: ItemAgenda[] = [];
      if (cotas.sinal > 0) itens.push(...(await reservarSinal(tx, 'proximo_sinal_em', cotas.sinal, agora, posseAte)));
      if (cotas.reconciliacao > 0) itens.push(...(await reservarSinal(tx, 'proxima_reconciliacao_em', cotas.reconciliacao, agora, posseAte)));
      const restante = limite - itens.length;
      if (restante > 0) itens.push(...(await reservarEnvios(tx, restante, agora, posseAte)));
      return itens;
    },
    async executar(item, ctx) {
      if (item.tarefa === 'envio') return executarEnvio(item, ctx, { outbox: deps.outbox });
      if (item.tarefa === 'sinal') return executarSinal(item, ctx);
      if (item.tarefa === 'reconciliacao') return executarReconciliacao(item, ctx);
    },
    async semLicenca(item, tx, agora) {
      if (item.tarefa === 'envio') {
        await tx.consultar(
          `UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'licenca_erp', pausada_em = $3, updated_at = now()
            WHERE tenant_id = $1 AND entidade::text = $2 AND pausada_motivo IS NULL AND deleted_at IS NULL`,
          [item.tenant_id, item.chave, agora],
        );
        return;
      }
      // sinal e reconciliação não têm pausa própria: voltam a olhar em 1 h (ou no dia seguinte)
      const [coluna, para] = item.tarefa === 'sinal' ? (['proximo_sinal_em', mais(agora, UMA_HORA_S)] as const) : (['proxima_reconciliacao_em', proximaReconciliacaoEm(agora)] as const);
      await tx.consultar(`UPDATE integracao_fdv.sinal SET ${coluna} = $2, updated_at = now() WHERE tenant_id = $1`, [item.tenant_id, para]);
    },
  };
}
