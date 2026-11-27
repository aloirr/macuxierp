/**
 * Rotina diária `cadastros.completar-prazo-medio` (T-0108, decisões 14 A, 16 A e 17 B do Alexandre, R-20261125-154127 e
 * R-20261125-155145): completa o prazo médio das condições de pagamento já gravadas com ele vazio. A regra e a gravação são
 * do `completarPrazosMedios` do cadastros. Aqui só entram o horário, a lista de tenants, a transação de cada tenant (papel
 * `macuxierp_worker`, RLS) e o interruptor de emergência. `horaUtc` 0: roda no primeiro ciclo depois do deploy e depois uma vez por dia.
 * O log leva só contagens, `tenant_id` e o nome do erro.
 */
import { completarPrazosMedios, repositoriosSql } from '@macuxierp/cadastros/api';
import { fonteTenantsSql } from '@macuxierp/core/api';
import type { Banco, DestinoAuditoria, Outbox, Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { Logger } from 'pino';
import { paraCadaTenant, type RotinaDiaria } from './rotinas';

export const ROTINA_COMPLETAR_PRAZO_MEDIO = 'cadastros.completar-prazo-medio';

/** Interruptor de emergência (decisão 16 A): `MACUXIERP_COMPLETAR_PRAZO_MEDIO=desligado` tira a rotina do laço. Padrão: ligada. */
export function completarPrazoMedioLigado(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.MACUXIERP_COMPLETAR_PRAZO_MEDIO ?? '').trim().toLowerCase() !== 'desligado';
}

export interface DependenciasCompletarPrazoMedio {
  banco: Banco;
  log: Pick<Logger, 'info' | 'warn'>;
  /** Padrão: `plataforma.tenants_ativos()` (adaptador SQL do core). */
  tenantsAtivos?: (tx: Transacao) => Promise<string[]>;
  outbox?: Outbox;
  auditoria?: DestinoAuditoria;
  /** Hora UTC da rodada (padrão 0: o primeiro ciclo depois do deploy já roda). */
  horaUtc?: number;
}

export function criarRotinaCompletarPrazoMedio(d: DependenciasCompletarPrazoMedio): RotinaDiaria {
  const outbox = d.outbox ?? new OutboxPg();
  const auditoria = d.auditoria ?? new AuditoriaPg();
  return {
    id: ROTINA_COMPLETAR_PRAZO_MEDIO,
    horaUtc: d.horaUtc ?? 0,
    async executar(agora) {
      // log: o aviso do 42501 do módulo (RN-CAD-16), só tenant_id, condicao_id e codigo
      const completar = completarPrazosMedios({ repositorios: repositoriosSql, outbox, auditoria, relogio: { agora: () => agora }, log: d.log });
      let completadas = 0;
      const r = await paraCadaTenant(d.banco, d.tenantsAtivos ?? ((tx) => fonteTenantsSql.ativos(tx)), ROTINA_COMPLETAR_PRAZO_MEDIO, d.log, async (tx, tenant_id) => {
        const n = (await completar(tx, tenant_id)).completadas;
        completadas += n;
        if (n > 0) d.log.info({ rotina: ROTINA_COMPLETAR_PRAZO_MEDIO, tenant_id, completadas: n }, 'prazo médio completado');
      });
      return { ...r, completadas };
    },
  };
}
