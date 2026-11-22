/**
 * T-0017: o lado ERP da volta, montado com o código do `main` como o `apps/worker` vai ligá-lo (T-0013 §5 e §6; a ligação
 * no worker ainda não existe, pendência na docs/testes/T-0017.md):
 *  - busca: `buscarPedidosPendentes` (integracao-fdv/api) com a porta `RecebedorPedidoFdv` real (`criarRecebedorFdv` do
 *    pedido/api, `repositorioSql`, consulta de cadastros `criarConsultaParaPedido` com o `repositoriosSql` do cadastros);
 *  - retorno: o consumidor `integracao-fdv.retorno-pedido` pelo despachante real da outbox (`despacharOutbox` do worker,
 *    `FilaOutboxPg`, `RegistroConsumoPg`) e o envio `enviarRetornosPendentes`;
 *  - Hub: `criarClienteHubPedidos` (cliente HTTP do SDK);
 *  - chaves do Hub: `criarResolvedorChaveErp` do `cadastros/api` (ADR 0010, item 2), a mesma porta que o worker vai ligar.
 * Logs e alertas ficam em memória para a varredura de LGPD (por contagem e índice, nunca pelo valor).
 */
import type { Banco, Relogio } from '../../../packages/platform-sdk/src/index';
import { AuditoriaPg, LicencasPg, OutboxPg } from '../../../packages/platform-sdk/src/pg';
import { despacharOutbox } from '../../../apps/worker/src/despachante';
import { FilaOutboxPg, RegistroConsumoPg } from '../../../apps/worker/src/pg';
import { criarConsultaParaPedido, criarResolvedorChaveErp, repositoriosSql } from '../../../modules/cadastros/api/index';
import type { Alertar, LogPedidos } from '../../../modules/integracao-fdv/api/portas';
import { buscarPedidosPendentes, type ResumoBusca } from '../../../modules/integracao-fdv/api/recebimento-pedidos';
import {
  criarConsumidorRetornoPedido,
  enviarRetornosPendentes,
  type ResumoEnvio,
} from '../../../modules/integracao-fdv/api/retorno-pedidos';
import { criarRecebedorFdv, dependenciasDeProducao } from '../../../modules/pedido/api/index';
import type { ClienteHubPedidosArnes } from './cliente-hub-pedidos';

export interface RegistroLgpd {
  /** Uma linha por chamada de log (objeto + mensagem), em JSON. */
  logs: string[];
  /** `codigo:contexto` de cada alerta do monitor. */
  alertas: string[];
}

type LogWorker = Parameters<typeof despacharOutbox>[0]['log'];

function criarRegistroLgpd(): RegistroLgpd & { log: LogPedidos; alertar: Alertar; pino: LogWorker } {
  const r: RegistroLgpd = { logs: [], alertas: [] };
  const linha = (o: Record<string, unknown>, m: string) => void r.logs.push(JSON.stringify([o, m]));
  const log: LogPedidos = { info: linha, warn: linha, error: linha };
  const alertar: Alertar = (_t, codigo, ctx) => void r.alertas.push(`${codigo}:${JSON.stringify(ctx ?? {})}`);
  const pino = {
    info: (o: Record<string, unknown>, m: string) => linha(o, m),
    warn: (o: Record<string, unknown>, m: string) => linha(o, m),
    error: (o: Record<string, unknown>, m: string) => linha(o, m),
    child: () => pino,
  };
  return { ...r, log, alertar, pino: pino as unknown as LogWorker };
}

/** Índices das linhas que contêm algum dos valores (o teste compara só os índices: o valor nunca vai à mensagem). */
export function indicesCom(linhas: readonly string[], valores: readonly string[]): number[] {
  return linhas.flatMap((l, i) => (valores.some((v) => l.includes(v)) ? [i] : []));
}

export interface LadoErpPedidos {
  buscar(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<ResumoBusca>;
  /** Despacha a outbox (todos os tenants) para o consumidor do retorno. */
  despachar(): Promise<void>;
  enviar(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<ResumoEnvio>;
  /** Uma volta inteira do worker: busca, despacho e envio. */
  ciclo(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<{ busca: ResumoBusca; envio: ResumoEnvio }>;
  lgpd: RegistroLgpd;
  consumidor: ReturnType<typeof criarConsumidorRetornoPedido>;
}

export function criarLadoErpPedidos(o: { banco: Banco; relogio: Relogio }): LadoErpPedidos {
  const reg = criarRegistroLgpd();
  const pedido = dependenciasDeProducao(criarConsultaParaPedido(repositoriosSql), { log: reg.log });
  const recebedor = criarRecebedorFdv({ ...pedido, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: o.relogio });
  // L3 da T-0011: `alertar` opcional (`retorno_sem_chave_produto`); em objeto à parte para tipar também sem o parâmetro.
  const opcoesRetorno = { log: reg.log, relogio: o.relogio, alertar: reg.alertar };
  const consumidor = criarConsumidorRetornoPedido(opcoesRetorno);
  const resolvedor = criarResolvedorChaveErp(repositoriosSql);
  const comum = { banco: o.banco, relogio: o.relogio, log: reg.log, alertar: reg.alertar };
  const lado: LadoErpPedidos = {
    lgpd: reg,
    consumidor,
    buscar: (t, hub) => buscarPedidosPendentes({ ...comum, hub, recebedor, resolvedor }, t),
    async despachar() {
      for (let i = 0; i < 10; i++) {
        const r = await despacharOutbox({ banco: o.banco, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores: [consumidor], relogio: o.relogio, log: reg.pino });
        if (r.publicados + r.falhas === 0) return;
      }
    },
    enviar: (t, hub) => enviarRetornosPendentes({ ...comum, hub }, t),
    async ciclo(t, hub) {
      const busca = await lado.buscar(t, hub);
      await lado.despachar();
      return { busca, envio: await lado.enviar(t, hub) };
    },
  };
  return lado;
}
