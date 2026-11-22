/**
 * Dependências dos consumidores das notas do faturamento, ligados em `montarConsumidores` (`modulos.ts`; T-0045, lote C):
 * - pedido (`consumidoresDoPedido`, #194; `faturamento.nota.autorizada@1`): recusa determinística não lança (loga,
 *   `alertar` e conta como consumida); erro transitório lança e volta pelo backoff do despachante até o limite;
 * - estoque pela nota (`criarConsumidorEstoqueNota`, #192; `faturamento.nota.autorizada@1` e `nota.cancelada@1`).
 * O alerta é o do monitor (`criarAlertaMonitor`), com o módulo certo e só códigos e ids (regra 8).
 */
import { repositoriosSql } from '@macuxierp/cadastros/api';
import type { Outbox, Relogio } from '@macuxierp/platform-sdk';
import { OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { Logger } from 'pino';
import { criarAlertaMonitor } from './pedidos-fdv';
import type { AlertarWorker } from './portas';

export interface EntradaLigacoes {
  log: Logger;
  relogio: Relogio;
  /** Padrão: `plataforma.evento` (PG), na transação do evento. */
  outbox?: Outbox;
}

/** Dependências de `consumidoresDoPedido` (`DependenciasConsumidoresPedido`). */
export function depsConsumidoresPedido(d: EntradaLigacoes): { outbox: Outbox; relogio: Relogio; log: Logger; alertar: AlertarWorker } {
  return { outbox: d.outbox ?? new OutboxPg(), relogio: d.relogio, log: d.log.child({ modulo: 'pedido' }), alertar: criarAlertaMonitor(d.log, 'pedido') };
}

/** Dependências de `criarConsumidorEstoqueNota`. O aviso técnico vai ao log do worker (só ids), não ao console. */
export function depsConsumidorEstoqueNota(d: EntradaLigacoes): {
  repositorios: typeof repositoriosSql;
  outbox: Outbox;
  agora: () => Date;
  registrar: (msg: string) => void;
} {
  const log = d.log.child({ modulo: 'cadastros' });
  return { repositorios: repositoriosSql, outbox: d.outbox ?? new OutboxPg(), agora: () => d.relogio.agora(), registrar: (msg) => log.warn(msg) };
}
