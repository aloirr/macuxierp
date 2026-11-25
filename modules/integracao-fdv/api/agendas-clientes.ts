/**
 * Agendas do pré-cadastro de cliente do FDV (T-0059 §5):
 * - `integracao-fdv.busca-clientes`, sobre `sinal.proxima_busca_clientes_em` (`GET /clientes/pendentes?limite=50`, a cada 60 s);
 * - `integracao-fdv.retorno-clientes`, sobre `sinal.proximo_retorno_clientes_em` (`POST /clientes/{cliente_uuid}/retorno`).
 * Mesmo molde das agendas de pedidos (`agendas-pedidos`): reserva com `FOR NO KEY UPDATE SKIP LOCKED` e adiamento preso à posse;
 * o HTTP vai só por `ctx.hub` e nunca dentro de `ctx.emTransacao`; a chave do conector só existe em memória, dentro do
 * `ClienteHubClientes` da chamada. O registro destas agendas no `apps/worker` é do engenheiro-software (sob o
 * `MACUXIERP_FDV_RECEBIMENTO`, como os pedidos; `aditivos` vem de `aditivosClienteFdvLigados`). Sem dado pessoal em log.
 */
import type { AgendaModulo, ClienteHub, CredencialHub, Relogio } from '@macuxierp/platform-sdk';
import { atrasoRetentativaSegundos, retryAfterSegundos } from '../domain';
import { bancoDoItem, criarApoioAgendaHub } from './apoio-agenda-hub';
import { UMA_HORA_S, adiarPresoAPosse, adiarSinalSemLicenca, marcarUsoDaCredencial, mais, reservarSinal } from './conector-comum';
import type { Alertar, ClienteHubClientes, CriadorClienteFdv, LogPedidos, RespostaPendentesClientes, RespostaRetornoCliente } from './portas';
import { buscarClientesPendentes } from './recebimento-clientes';
import { enviarRetornosClientes } from './retorno-clientes';

export const AGENDA_BUSCA_CLIENTES_ID = 'integracao-fdv.busca-clientes';
export const AGENDA_RETORNO_CLIENTES_ID = 'integracao-fdv.retorno-clientes';

/** Entre uma busca e outra (desenho §5.1). */
const INTERVALO_BUSCA_CLIENTES_S = 60;

export interface DepsAgendasClientesFdv {
  /** `criarCriadorClienteFdv` do `cadastros/api`. */
  criador: CriadorClienteFdv;
  alertar: Alertar;
  log: LogPedidos;
  relogio: Relogio;
  /** `aditivosClienteFdvLigados(env)`: o retorno leva `revisao` e `erros` (padrão ligado). */
  aditivos: boolean;
}

/** `ClienteHubClientes` sobre o `ClienteHub` do SDK. A credencial fica só neste fechamento; erro da porta (`ErroClienteHub`) sobe. */
function criarClienteHubClientes(hub: ClienteHub, cred: CredencialHub, log: LogPedidos): ClienteHubClientes {
  return {
    async pendentes(limite): Promise<RespostaPendentesClientes> {
      const r = await hub.chamar(cred, { metodo: 'GET', caminho: `/clientes/pendentes?limite=${Math.trunc(limite)}` });
      if (r.tipo === 'ok') {
        // Só `{ clientes: [...] }` é o contrato do Hub; qualquer outra forma é erro (a busca reagenda), nunca um palpite.
        const clientes = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { clientes?: unknown }).clientes : undefined;
        if (!Array.isArray(clientes)) {
          log.error({ modulo: 'integracao-fdv', codigo: 'pendentes_fora_do_contrato', http: r.status }, 'resposta de clientes pendentes fora do contrato');
          return { status: r.status };
        }
        return { status: r.status, clientes };
      }
      if (r.tipo === 'retentavel') {
        const ra = retryAfterSegundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(ra != null ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
    async enviarRetorno(clienteUuid, corpo): Promise<RespostaRetornoCliente> {
      const r = await hub.chamar(cred, { metodo: 'POST', caminho: `/clientes/${clienteUuid}/retorno`, corpo });
      if (r.tipo === 'ok') {
        const c = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { repetido?: unknown }) : {};
        return { status: r.status, repetido: r.replay || c.repetido === true };
      }
      if (r.tipo === 'retentavel') {
        const ra = retryAfterSegundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(r.codigo ? { codigo: r.codigo } : {}), ...(ra != null ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
  };
}

export function criarAgendasClientesFdv(d: DepsAgendasClientesFdv): readonly AgendaModulo[] {
  const { credencialDaTarefa, pausarEAdiar, defeitoNoHub } = criarApoioAgendaHub(d.log, 'clientes');

  const busca: AgendaModulo = {
    id: AGENDA_BUSCA_CLIENTES_ID,
    modulo: 'integracao-fdv',
    reservar: (tx, limite, agora, posseAte) => reservarSinal(tx, 'proxima_busca_clientes_em', 'busca-clientes', limite, agora, posseAte),
    async executar(item, ctx) {
      const tenant = item.tenant_id;
      const col = 'proxima_busca_clientes_em';
      const c = await credencialDaTarefa(ctx, tenant, col);
      if (!c) return;
      let resumo;
      try {
        resumo = await buscarClientesPendentes(
          { banco: bancoDoItem(ctx, tenant), hub: criarClienteHubClientes(ctx.hub, c.cred, d.log), criador: d.criador, relogio: d.relogio, log: d.log, alertar: d.alertar, aditivos: d.aditivos, posseAte: ctx.posseAte },
          tenant,
        );
      } catch (e) {
        return defeitoNoHub(e, ctx, tenant, col, c.credencialId);
      }
      const agora = d.relogio.agora();
      await ctx.emTransacao(async (tx) => {
        if (resumo.motivoPausa) return pausarEAdiar(tx, ctx, tenant, col, resumo.motivoPausa, c.credencialId, agora);
        if (resumo.proxima === 'erro') {
          const espera = Math.max(INTERVALO_BUSCA_CLIENTES_S, atrasoRetentativaSegundos(1, resumo.retryAfterS));
          await adiarPresoAPosse(tx, tenant, { sinal: col }, ctx.posseAte, mais(agora, espera));
          return;
        }
        await marcarUsoDaCredencial(tx, tenant, c.credencialId, agora);
        await adiarPresoAPosse(tx, tenant, { sinal: col }, ctx.posseAte, resumo.proxima === 'imediata' ? agora : mais(agora, INTERVALO_BUSCA_CLIENTES_S));
      });
    },
    // Sem licença do módulo a tarefa não se desliga nem pausa; só volta a olhar em 1 h (com a licença, segue sozinha).
    semLicenca: (item, tx, agora) => adiarSinalSemLicenca(tx, item.tenant_id, 'proxima_busca_clientes_em', mais(agora, UMA_HORA_S)),
  };

  const retorno: AgendaModulo = {
    id: AGENDA_RETORNO_CLIENTES_ID,
    modulo: 'integracao-fdv',
    reservar: (tx, limite, agora, posseAte) => reservarSinal(tx, 'proximo_retorno_clientes_em', 'retorno-clientes', limite, agora, posseAte),
    async executar(item, ctx) {
      const tenant = item.tenant_id;
      const col = 'proximo_retorno_clientes_em';
      const c = await credencialDaTarefa(ctx, tenant, col);
      if (!c) return;
      let resumo;
      try {
        resumo = await enviarRetornosClientes({ banco: bancoDoItem(ctx, tenant), hub: criarClienteHubClientes(ctx.hub, c.cred, d.log), relogio: d.relogio, log: d.log, alertar: d.alertar, posseAte: ctx.posseAte }, tenant);
      } catch (e) {
        return defeitoNoHub(e, ctx, tenant, col, c.credencialId);
      }
      const agora = d.relogio.agora();
      await ctx.emTransacao(async (tx) => {
        if (resumo.enviados > 0) await marcarUsoDaCredencial(tx, tenant, c.credencialId, agora);
        if (resumo.motivoPausa) await pausarEAdiar(tx, ctx, tenant, col, resumo.motivoPausa, c.credencialId, agora);
      });
    },
    semLicenca: (item, tx, agora) => adiarSinalSemLicenca(tx, item.tenant_id, 'proximo_retorno_clientes_em', mais(agora, UMA_HORA_S)),
  };

  return Object.freeze([busca, retorno]);
}
