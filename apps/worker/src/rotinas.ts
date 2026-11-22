/**
 * Rotinas diárias do worker (ex.: alerta do A1, RF-CORE-04). Cada rotina roda uma vez por dia UTC, a partir de
 * `horaUtc`; o estado fica na memória do processo, então o efeito precisa ser idempotente (reinício ou dois workers
 * rodam de novo no mesmo dia sem duplicar). Falha espera 15 min para a próxima tentativa, sem derrubar o laço.
 */
import type { Logger } from 'pino';
import { nomeDoErro } from './backoff';

export interface RotinaDiaria {
  id: string;
  horaUtc: number;
  /** Devolve um resumo só com contagens (vai para o log). */
  executar(agora: Date): Promise<Record<string, number>>;
}

export type EstadoRotinas = Map<string, { dia?: string; tentarApos?: number }>;

const ESPERA_FALHA_MS = 15 * 60_000;

/** Roda as rotinas vencidas. Devolve quantas rodaram com sucesso. */
export async function rodarRotinas(rotinas: readonly RotinaDiaria[], estado: EstadoRotinas, agora: Date, log: Logger): Promise<number> {
  let rodadas = 0;
  const dia = agora.toISOString().slice(0, 10);
  for (const r of rotinas) {
    const e = estado.get(r.id) ?? {};
    if (agora.getUTCHours() < r.horaUtc || e.dia === dia || (e.tentarApos ?? 0) > agora.getTime()) continue;
    try {
      const resumo = await r.executar(agora);
      estado.set(r.id, { dia });
      rodadas++;
      log.info({ rotina: r.id, ...resumo }, 'rotina diária concluída');
    } catch (err) {
      estado.set(r.id, { ...e, tentarApos: agora.getTime() + ESPERA_FALHA_MS });
      log.error({ rotina: r.id, erro: nomeDoErro(err) }, 'rotina diária falhou');
    }
  }
  return rodadas;
}
