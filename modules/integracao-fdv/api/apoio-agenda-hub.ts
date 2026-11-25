/**
 * Peças comuns das agendas que falam com o Hub dos pedidos e dos pré-cadastros de cliente (`agendas-pedidos`,
 * `agendas-clientes`): banco preso ao item da agenda, credencial da tarefa, pausa e defeito do uso da porta. A chave do
 * conector só existe em memória, dentro da credencial aberta da chamada.
 */
import type { Banco, ContextoAgenda, Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import {
  UMA_HORA_S,
  abrirOuPausar,
  adiarPresoAPosse,
  defeitoDoCliente,
  mais,
  pausarEntidades,
  prepararCredencial,
  type ColunaSinalAgenda,
} from './conector-comum';
import type { LogPedidos } from './portas';

/** Só `comTenant`, preso ao tenant do item e à transação do laço (`ctx.emTransacao`): outro tenant é erro de programação. */
export function bancoDoItem(ctx: ContextoAgenda, tenantId: string): Pick<Banco, 'comTenant'> {
  return {
    comTenant: (id, fn) => {
      if (id !== tenantId) throw new Error('agenda do Hub: tenant diferente do item');
      return ctx.emTransacao(fn);
    },
  };
}

export function criarApoioAgendaHub(log: LogPedidos, rotulo: string) {
  /** Credencial pronta (aberta só em memória) ou `null` (sem credencial, já recusada ou ilegível: a tarefa já foi adiada ou pausada). */
  async function credencialDaTarefa(ctx: ContextoAgenda, tenant: string, coluna: ColunaSinalAgenda) {
    const adiarUmaHora = (tx: Transacao): Promise<void> => adiarPresoAPosse(tx, tenant, { sinal: coluna }, ctx.posseAte, mais(ctx.agora, UMA_HORA_S));
    const base = await ctx.emTransacao((tx) => prepararCredencial(tx, tenant, { semCredencial: () => adiarUmaHora(tx), recusada: () => adiarUmaHora(tx) }));
    if (!base) return null;
    const cred = await abrirOuPausar(ctx, tenant, base);
    return cred ? { cred, credencialId: base.id } : null;
  }

  /** Pausa (com `motivo`; `null` = só adia) e adia a tarefa em 1 h, presa à posse. */
  async function pausarEAdiar(tx: Transacao, ctx: ContextoAgenda, tenant: string, coluna: ColunaSinalAgenda, motivo: MotivoPausa | null, credencialId: string, agora: Date): Promise<void> {
    if (motivo) await pausarEntidades(tx, tenant, null, motivo, credencialId, agora);
    await adiarPresoAPosse(tx, tenant, { sinal: coluna }, ctx.posseAte, mais(agora, UMA_HORA_S));
  }

  /** Defeito do ERP no uso da porta (`ErroClienteHub`): repetir não conserta; adia 1 h e, se a credencial é a culpada, pausa. Outro erro sobe. */
  async function defeitoNoHub(e: unknown, ctx: ContextoAgenda, tenant: string, coluna: ColunaSinalAgenda, credencialId: string): Promise<void> {
    const x = defeitoDoCliente(e);
    if (!x) throw e;
    log.error({ tenant_id: tenant, modulo: 'integracao-fdv', codigo: x.codigo }, `chamada ao Hub de ${rotulo} recusada pela porta`);
    await ctx.emTransacao((tx) => pausarEAdiar(tx, ctx, tenant, coluna, x.credencial ? 'credencial' : null, credencialId, ctx.agora));
  }

  return { credencialDaTarefa, pausarEAdiar, defeitoNoHub };
}
