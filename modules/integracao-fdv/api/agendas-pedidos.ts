/**
 * Agendas do recebimento e do retorno de pedidos do FDV (contrato C-9, T-0009 §6.1; T-0013 §5 e §6; T-0016):
 * - `integracao-fdv.busca-pedidos`, sobre `sinal.proxima_busca_pedidos_em` (`GET /pedidos/pendentes?limite=50`);
 * - `integracao-fdv.retorno-pedidos`, sobre `sinal.proximo_retorno_em` (`POST /pedidos/{uuid}/retorno`).
 * Reserva com `FOR NO KEY UPDATE SKIP LOCKED` e adiamento para `posseAte` na mesma transação; só a coluna da própria agenda
 * é tocada (as do envio, do sinal e da reconciliação são da `agenda-conector`). Credencial e pausa pelos helpers do
 * `conector-comum`; o HTTP vai só por `ctx.hub` e nunca dentro de `ctx.emTransacao`. A chave do conector só existe em memória,
 * dentro do `ClienteHubPedidos` da chamada. Sem dado pessoal em log (as rotinas de pedido já logam só ids e códigos).
 */
import type { AgendaModulo, Banco, ClienteHub, ContextoAgenda, CredencialHub, Relogio, Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import { atrasoRetentativaSegundos, retryAfterSegundos } from '../domain';
import {
  UMA_HORA_S,
  abrirOuPausar,
  adiarPresoAPosse,
  adiarSinalSemLicenca,
  defeitoDoCliente,
  marcarUsoDaCredencial,
  mais,
  pausarEntidades,
  prepararCredencial,
  reservarSinal,
  type ColunaSinalAgenda,
} from './conector-comum';
import type { Alertar, ClienteHubPedidos, LogPedidos, RecebedorPedidoFdv, ResolvedorChaveErp, RespostaPendentes, RespostaRetorno } from './portas';
import { buscarPedidosPendentes } from './recebimento-pedidos';
import { enviarRetornosPendentes } from './retorno-pedidos';

export const AGENDA_BUSCA_PEDIDOS_ID = 'integracao-fdv.busca-pedidos';
export const AGENDA_RETORNO_PEDIDOS_ID = 'integracao-fdv.retorno-pedidos';

/** Entre uma busca e outra (doc 06: a cada 1 a 2 min). */
const INTERVALO_BUSCA_PEDIDOS_S = 60;

export interface DepsAgendasPedidosFdv {
  /** `criarRecebedorFdv` do `pedido/api`. */
  recebedor: RecebedorPedidoFdv;
  /** `cadastros/api` (ADR 0010, item 2). */
  resolvedor: ResolvedorChaveErp;
  alertar: Alertar;
  log: LogPedidos;
  relogio: Relogio;
}

/** `ClienteHubPedidos` sobre o `ClienteHub` do SDK. A credencial fica só neste fechamento; erro da porta (`ErroClienteHub`) sobe. */
function criarClienteHubPedidos(hub: ClienteHub, cred: CredencialHub, log: LogPedidos): ClienteHubPedidos {
  return {
    async pendentes(limite): Promise<RespostaPendentes> {
      const r = await hub.chamar(cred, { metodo: 'GET', caminho: `/pedidos/pendentes?limite=${Math.trunc(limite)}` });
      if (r.tipo === 'ok') {
        // Só `{ pedidos: [...] }` é o contrato do Hub; qualquer outra forma é erro (a busca reagenda), nunca um palpite.
        const pedidos = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { pedidos?: unknown }).pedidos : undefined;
        if (!Array.isArray(pedidos)) {
          log.error({ modulo: 'integracao-fdv', codigo: 'pendentes_fora_do_contrato', http: r.status }, 'resposta de pedidos pendentes fora do contrato');
          return { status: r.status };
        }
        return { status: r.status, pedidos };
      }
      if (r.tipo === 'retentavel') {
        const ra = retryAfterSegundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(ra != null ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
    async enviarRetorno(pedidoUuid, corpo): Promise<RespostaRetorno> {
      const r = await hub.chamar(cred, { metodo: 'POST', caminho: `/pedidos/${pedidoUuid}/retorno`, corpo });
      if (r.tipo === 'ok') {
        const c = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { repetido?: unknown; itens_descartados?: unknown }) : {};
        return {
          status: r.status,
          repetido: r.replay || c.repetido === true,
          ...(Array.isArray(c.itens_descartados) ? { itens_descartados: c.itens_descartados } : {}),
        };
      }
      if (r.tipo === 'retentavel') {
        const ra = retryAfterSegundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(r.codigo ? { codigo: r.codigo } : {}), ...(ra != null ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
  };
}

/** Só `comTenant`, preso ao tenant do item e à transação do laço (`ctx.emTransacao`): outro tenant é erro de programação. */
function bancoDoItem(ctx: ContextoAgenda, tenantId: string): Pick<Banco, 'comTenant'> {
  return {
    comTenant: (id, fn) => {
      if (id !== tenantId) throw new Error('agenda de pedidos: tenant diferente do item');
      return ctx.emTransacao(fn);
    },
  };
}

export function criarAgendasPedidosFdv(d: DepsAgendasPedidosFdv): readonly AgendaModulo[] {
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
    d.log.error({ tenant_id: tenant, modulo: 'integracao-fdv', codigo: x.codigo }, 'chamada ao Hub de pedidos recusada pela porta');
    await ctx.emTransacao((tx) => pausarEAdiar(tx, ctx, tenant, coluna, x.credencial ? 'credencial' : null, credencialId, ctx.agora));
  }

  // Intencional: a reserva destas duas agendas não olha a pausa das entidades (`cursor_entidade.pausada_motivo`). A pausa é da
  // credencial e é conferida por `prepararCredencial` a cada execução, que adia 1 h sem chamar o Hub (limite de falhas por IP).
  const busca: AgendaModulo = {
    id: AGENDA_BUSCA_PEDIDOS_ID,
    modulo: 'integracao-fdv',
    reservar: (tx, limite, agora, posseAte) => reservarSinal(tx, 'proxima_busca_pedidos_em', 'busca', limite, agora, posseAte),
    async executar(item, ctx) {
      const tenant = item.tenant_id;
      const col = 'proxima_busca_pedidos_em';
      const c = await credencialDaTarefa(ctx, tenant, col);
      if (!c) return;
      let resumo;
      try {
        resumo = await buscarPedidosPendentes({ banco: bancoDoItem(ctx, tenant), hub: criarClienteHubPedidos(ctx.hub, c.cred, d.log), recebedor: d.recebedor, resolvedor: d.resolvedor, relogio: d.relogio, log: d.log, alertar: d.alertar, posseAte: ctx.posseAte }, tenant);
      } catch (e) {
        return defeitoNoHub(e, ctx, tenant, col, c.credencialId);
      }
      const agora = d.relogio.agora();
      await ctx.emTransacao(async (tx) => {
        if (resumo.motivoPausa) return pausarEAdiar(tx, ctx, tenant, col, resumo.motivoPausa, c.credencialId, agora);
        if (resumo.proxima === 'desligada') {
          // módulo `pedido` sem licença: a própria busca já adiou a coluna em 1 h (presa à posse); nada a regravar aqui
          return;
        }
        if (resumo.proxima === 'erro') {
          const espera = Math.max(INTERVALO_BUSCA_PEDIDOS_S, atrasoRetentativaSegundos(1, resumo.retryAfterS));
          await adiarPresoAPosse(tx, tenant, { sinal: col }, ctx.posseAte, mais(agora, espera));
          return;
        }
        await marcarUsoDaCredencial(tx, tenant, c.credencialId, agora);
        await adiarPresoAPosse(tx, tenant, { sinal: col }, ctx.posseAte, resumo.proxima === 'imediata' ? agora : mais(agora, INTERVALO_BUSCA_PEDIDOS_S));
      });
    },
    // Intencional: sem licença do módulo a tarefa não se desliga nem pausa; só volta a olhar em 1 h (se a licença voltar, segue sozinha).
    semLicenca: (item, tx, agora) => adiarSinalSemLicenca(tx, item.tenant_id, 'proxima_busca_pedidos_em', mais(agora, UMA_HORA_S)),
  };

  const retorno: AgendaModulo = {
    id: AGENDA_RETORNO_PEDIDOS_ID,
    modulo: 'integracao-fdv',
    reservar: (tx, limite, agora, posseAte) => reservarSinal(tx, 'proximo_retorno_em', 'retorno', limite, agora, posseAte),
    async executar(item, ctx) {
      const tenant = item.tenant_id;
      const col = 'proximo_retorno_em';
      const c = await credencialDaTarefa(ctx, tenant, col);
      if (!c) return;
      let resumo;
      try {
        // `posseAte` faz o envio parar antes do fim da posse e prende toda regravação de `proximo_retorno_em` a ela
        resumo = await enviarRetornosPendentes({ banco: bancoDoItem(ctx, tenant), hub: criarClienteHubPedidos(ctx.hub, c.cred, d.log), relogio: d.relogio, log: d.log, alertar: d.alertar, posseAte: ctx.posseAte }, tenant);
      } catch (e) {
        return defeitoNoHub(e, ctx, tenant, col, c.credencialId);
      }
      const agora = d.relogio.agora();
      await ctx.emTransacao(async (tx) => {
        if (resumo.enviados > 0) await marcarUsoDaCredencial(tx, tenant, c.credencialId, agora);
        if (resumo.motivoPausa) await pausarEAdiar(tx, ctx, tenant, col, resumo.motivoPausa, c.credencialId, agora);
      });
    },
    semLicenca: (item, tx, agora) => adiarSinalSemLicenca(tx, item.tenant_id, 'proximo_retorno_em', mais(agora, UMA_HORA_S)),
  };

  return Object.freeze([busca, retorno]);
}
