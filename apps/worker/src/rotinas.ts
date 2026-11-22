/**
 * Rotinas do worker, com o estado na memória do processo (o efeito precisa ser idempotente: reinício ou dois workers repetem
 * sem duplicar). Periódicas (`RotinaPeriodica`, ex.: varredura do faturamento): a cada `intervaloMs`; a falha espera o
 * próximo intervalo. Diárias (ex.: alerta do A1, RF-CORE-04): uma vez por dia UTC, a partir de `horaUtc`; a falha espera
 * 15 min, sem derrubar o laço.
 */
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro } from './backoff';

export const DIA_MS = 86_400_000;

export interface RotinaDiaria {
  id: string;
  horaUtc: number;
  /** Devolve um resumo só com contagens (vai para o log). */
  executar(agora: Date): Promise<Record<string, number>>;
}

export type EstadoRotinas = Map<string, { dia?: string; tentarApos?: number }>;

const ESPERA_FALHA_MS = 15 * 60_000;

/**
 * Laço das rotinas diárias por tenant: lista os tenants em `semTenant` e roda `fazer` na transação de cada um (RLS). A falha de um tenant não para
 * os outros: conta em `falhas` e vai ao log com a rotina, o `tenant_id` e só o nome do erro. A falha da LISTA sobe (a rotina toda falha).
 */
export async function paraCadaTenant(
  banco: Banco,
  listar: (tx: Transacao) => Promise<string[]>,
  rotina: string,
  log: Pick<Logger, 'warn'>,
  fazer: (tx: Transacao, tenant_id: string) => Promise<void>,
): Promise<{ tenants: number; falhas: number }> {
  const r = { tenants: 0, falhas: 0 };
  for (const tenant_id of await banco.semTenant(listar)) {
    r.tenants++;
    try {
      await banco.comTenant(tenant_id, (tx) => fazer(tx, tenant_id));
    } catch (e) {
      r.falhas++;
      log.warn({ rotina, tenant_id, erro: nomeDoErro(e) }, 'rotina diária falhou no tenant');
    }
  }
  return r;
}

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

export interface RotinaPeriodica {
  id: string;
  intervaloMs: number;
  /** Devolve um resumo só com contagens (vai para o log quando houve algo além de `tenants`). */
  executar(agora: Date): Promise<Record<string, number>>;
}

/** Próxima execução (ms) de cada rotina periódica. */
export type EstadoPeriodicas = Map<string, number>;

/** Roda as rotinas periódicas vencidas. Devolve quantas rodaram com sucesso. */
export async function rodarPeriodicas(rotinas: readonly RotinaPeriodica[], estado: EstadoPeriodicas, agora: Date, log: Logger): Promise<number> {
  let rodadas = 0;
  for (const r of rotinas) {
    if ((estado.get(r.id) ?? 0) > agora.getTime()) continue;
    estado.set(r.id, agora.getTime() + r.intervaloMs);
    try {
      const resumo = await r.executar(agora);
      rodadas++;
      if (Object.entries(resumo).some(([k, v]) => k !== 'tenants' && v > 0)) log.info({ rotina: r.id, ...resumo }, 'rotina periódica concluída');
    } catch (err) {
      log.error({ rotina: r.id, erro: nomeDoErro(err) }, 'rotina periódica falhou');
    }
  }
  return rodadas;
}
