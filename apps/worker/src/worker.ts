/**
 * Laço do worker: despacha a outbox, processa a fila de `trabalho`, roda as agendas por tenant (Hub do FDV, T-0009
 * §6.1) e as rotinas diárias vencidas (alerta do A1); sem nada a fazer, espera `intervaloMs`.
 * `parar()` termina o ciclo corrente e sai (SIGTERM no deploy, ADR 0003). Erro de infraestrutura (banco fora) não
 * derruba o processo: loga o tipo e tenta de novo no próximo ciclo.
 */
import { setTimeout as esperar } from 'node:timers/promises';
import type { AgendaModulo } from '@macuxierp/platform-sdk';
import { despacharOutbox, type DependenciasDespachante } from './despachante';
import { processarTrabalhos, type DependenciasTrabalhos } from './trabalhos';
import { resumoAgendasVazio, rodarAgendas, type DependenciasAgendas } from './agenda';
import { nomeDoErro } from './backoff';
import type { FilaOutbox, ReservaTrabalhos } from './portas';
import { rodarRotinas, type EstadoRotinas, type RotinaDiaria } from './rotinas';

export type DependenciasWorker = Omit<DependenciasDespachante, 'fila' | 'lote'> &
  Omit<DependenciasTrabalhos, 'fila' | 'lote'> & {
    outbox: FilaOutbox;
    trabalhos: ReservaTrabalhos;
    rotinas?: readonly RotinaDiaria[];
    /** Agendas por tenant e o que elas pedem; ausente = laço de agenda desligado. */
    agenda?: Pick<DependenciasAgendas, 'licencas' | 'hub' | 'decifrarCredencial' | 'lote'> & { agendas: readonly AgendaModulo[] };
    intervaloMs?: number;
  };

/** Um ciclo: outbox, trabalhos, agendas e rotinas. Devolve se houve algo a fazer (para não dormir com fila cheia). */
export async function ciclo(d: DependenciasWorker, estado: EstadoRotinas = new Map()): Promise<boolean> {
  const o = await despacharOutbox({ ...d, fila: d.outbox });
  const t = await processarTrabalhos({ ...d, fila: d.trabalhos });
  const a = d.agenda ? await rodarAgendas(d.agenda.agendas, { ...d, ...d.agenda }) : resumoAgendasVazio();
  if (d.rotinas?.length) await rodarRotinas(d.rotinas, estado, d.relogio.agora(), d.log);
  const total = o.publicados + o.falhas + t.concluidos + t.falhas + t.desistidos + a.executados + a.falhas + a.semLicenca;
  if (total > 0) d.log.info({ outbox: o, trabalhos: t, agendas: a }, 'ciclo do worker');
  return o.publicados + t.concluidos + a.executados > 0;
}

export function iniciarWorker(d: DependenciasWorker): { parar(): Promise<void> } {
  const controle = new AbortController();
  const estado: EstadoRotinas = new Map();
  const laco = (async () => {
    while (!controle.signal.aborted) {
      let trabalhou = false;
      try {
        trabalhou = await ciclo(d, estado);
      } catch (e) {
        d.log.error({ erro: nomeDoErro(e) }, 'ciclo do worker falhou');
      }
      if (!trabalhou && !controle.signal.aborted) {
        await esperar(d.intervaloMs ?? 1_000, undefined, { signal: controle.signal }).catch(() => undefined);
      }
    }
  })();
  return {
    async parar() {
      controle.abort();
      await laco;
    },
  };
}
