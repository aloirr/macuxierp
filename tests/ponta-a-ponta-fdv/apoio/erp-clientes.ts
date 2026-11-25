/**
 * PF-1 da v0.3.13 (F-1 a F-6 do plano da v0.3.12): o lado ERP do pré-cadastro de cliente, com o código do `main`:
 *  - busca: `buscarClientesPendentes` (integracao-fdv/api) com a porta real `criarCriadorClienteFdv` (cadastros/api,
 *    `repositoriosSql`, outbox e auditoria no PostgreSQL);
 *  - espelho: o consumidor real `criarConsumidorPublicarCadastros` pelo despachante real da outbox (`despacharOutbox`),
 *    que retém o cliente aceito (`aguarda_vinculo`) até o 200 do vinculado (desenho T-0059 §5.4);
 *  - retorno: `enviarRetornosClientes`;
 *  - Hub: a porta `ClienteHubClientes` sobre o cliente HTTP do SDK (`clienteDoSdk`), a mesma tradução da
 *    `criarClienteHubClientes` da agenda (não exportada; o registro no `apps/worker` ainda falta, ver docs/testes).
 * Logs e alertas ficam em memória para a varredura de LGPD (por índice, nunca pelo valor).
 */
import type { Banco, Relogio } from '../../../packages/platform-sdk/src/index';
import { AuditoriaPg, LicencasPg, OutboxPg } from '../../../packages/platform-sdk/src/pg';
import { despacharOutbox } from '../../../apps/worker/src/despachante';
import { FilaOutboxPg, RegistroConsumoPg } from '../../../apps/worker/src/pg';
import { criarCriadorClienteFdv, repositoriosSql } from '../../../modules/cadastros/api/index';
import { criarConsumidorPublicarCadastros } from '../../../modules/integracao-fdv/api/consumidor-cadastros';
import type { Alertar, ClienteHubClientes, LogPedidos } from '../../../modules/integracao-fdv/api/portas';
import { buscarClientesPendentes, type ResumoBuscaClientes } from '../../../modules/integracao-fdv/api/recebimento-clientes';
import { enviarRetornosClientes, type ResumoEnvioClientes } from '../../../modules/integracao-fdv/api/retorno-clientes';
import { clienteDoSdk } from './adaptador-conector';
import type { CredencialHub } from './config';
import type { RegistroLgpd } from './erp-pedidos';

/** `ClienteHubClientes` sobre o cliente HTTP do SDK, com a mesma tradução da agenda (`agendas-clientes.ts`). */
export function criarClienteHubClientes(o: { url: string; credencial: CredencialHub; versaoErp: string }): ClienteHubClientes {
  const { cliente, cred } = clienteDoSdk(o);
  const segundos = (ms: number | null) => (ms === null ? undefined : Math.ceil(ms / 1000));
  return {
    async pendentes(limite) {
      const r = await cliente.chamar(cred, { metodo: 'GET', caminho: `/clientes/pendentes?limite=${Math.trunc(limite)}` });
      if (r.tipo === 'ok') {
        const lista = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { clientes?: unknown }).clientes : undefined;
        return { status: r.status, ...(Array.isArray(lista) ? { clientes: lista } : {}) };
      }
      if (r.tipo === 'retentavel') {
        const ra = segundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(ra !== undefined ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
    async enviarRetorno(uuid, corpo) {
      const r = await cliente.chamar(cred, { metodo: 'POST', caminho: `/clientes/${uuid}/retorno`, corpo });
      if (r.tipo === 'ok') {
        const c = r.corpo && typeof r.corpo === 'object' ? (r.corpo as { repetido?: unknown }) : {};
        return { status: r.status, repetido: r.replay || c.repetido === true };
      }
      if (r.tipo === 'retentavel') {
        const ra = segundos(r.retryAfterMs);
        return { status: r.status ?? 0, ...(r.codigo ? { codigo: r.codigo } : {}), ...(ra !== undefined ? { retryAfterS: ra } : {}) };
      }
      return { status: r.status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
  };
}

export interface LadoErpClientes {
  buscar(tenant: string, hub: ClienteHubClientes): Promise<ResumoBuscaClientes>;
  /** Despacha a outbox (todos os tenants) para o consumidor do espelho. */
  despachar(): Promise<void>;
  enviar(tenant: string, hub: ClienteHubClientes): Promise<ResumoEnvioClientes>;
  lgpd: RegistroLgpd;
}

export function criarLadoErpClientes(o: { banco: Banco; relogio: Relogio; aditivos?: boolean }): LadoErpClientes {
  const lgpd: RegistroLgpd = { logs: [], alertas: [] };
  const linha = (x: Record<string, unknown>, m: string) => void lgpd.logs.push(JSON.stringify([x, m]));
  const log: LogPedidos = { info: linha, warn: linha, error: linha };
  const alertar: Alertar = (_t, codigo, ctx) => void lgpd.alertas.push(`${codigo}:${JSON.stringify(ctx ?? {})}`);
  const pino = { info: linha, warn: linha, error: linha, child: () => pino } as unknown as Parameters<typeof despacharOutbox>[0]['log'];
  const criador = criarCriadorClienteFdv({ repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: o.relogio });
  const espelho = criarConsumidorPublicarCadastros({ licencas: new LicencasPg(), agora: () => o.relogio.agora() });
  const comum = { banco: o.banco, relogio: o.relogio, log, alertar };
  return {
    lgpd,
    buscar: (t, hub) => buscarClientesPendentes({ ...comum, hub, criador, aditivos: o.aditivos ?? true }, t),
    async despachar() {
      for (let i = 0; i < 10; i++) {
        const r = await despacharOutbox({ banco: o.banco, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores: [espelho], relogio: o.relogio, log: pino });
        if (r.publicados + r.falhas === 0) return;
      }
    },
    enviar: (t, hub) => enviarRetornosClientes({ ...comum, hub }, t),
  };
}
