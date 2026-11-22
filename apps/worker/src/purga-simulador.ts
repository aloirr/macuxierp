/**
 * Rotina diária `sefaz_simulador.purga` (T-0045 §9, lote B #220): retenção de 400 dias da memória do simulador da SEFAZ (LGPD; a guarda fiscal
 * de 5 anos é o nfeProc do faturamento, não isto). Para CADA tenant de `plataforma.tenant`, inclusive os suspensos, encerrados e apagados (a
 * retenção vale para quem saiu, mesmo sem a licença do faturamento), `purgarEstadoSimulador(tx, agora - 400 dias)` na transação do tenant
 * (papel `macuxierp_worker`, RLS). Idempotente: rodar de novo no mesmo dia não apaga nada a mais. Entra sempre, em todos os tenants, com ou sem
 * a chave do A1 (o simulador pode ter rodado antes). O log leva só contagens, `tenant_id` e o nome do erro (nada destas tabelas vai a log).
 * Enquanto a `plataforma.tenants_todos()` não existe (SQLSTATE 42883), a rodada fica PENDENTE: um aviso por dia, nada apagado, rotina concluída.
 */
import { purgarEstadoSimulador } from '@macuxierp/sefaz-simulador';
import type { Banco, FonteTodosTenants } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { DIA_MS, paraCadaTenant, type RotinaDiaria } from './rotinas';

/** Retenção da memória do simulador (desenho T-0045 §9). */
export const RETENCAO_SIMULADOR_DIAS = 400;

/** SQLSTATE `undefined_function`: a migração da `plataforma.tenants_todos()` ainda não entrou. */
const FUNCAO_INEXISTENTE = '42883';

export interface DependenciasPurgaSimulador {
  banco: Banco;
  tenants: FonteTodosTenants;
  log: Pick<Logger, 'warn'>;
  /** Hora UTC da rodada (padrão 7 h UTC = 3 h em Manaus, fora do expediente). */
  horaUtc?: number;
}

export function criarRotinaPurgaSimulador(d: DependenciasPurgaSimulador): RotinaDiaria {
  const rotina = 'sefaz_simulador.purga';
  return {
    id: rotina,
    horaUtc: d.horaUtc ?? 7,
    async executar(agora) {
      const antesDe = new Date(agora.getTime() - RETENCAO_SIMULADOR_DIAS * DIA_MS);
      const r = { notas: 0, eventos: 0, inutilizacoes: 0, recibos: 0 };
      try {
        const { tenants, falhas } = await paraCadaTenant(d.banco, (tx) => d.tenants.todos(tx), rotina, d.log, async (tx) => {
          const p = await purgarEstadoSimulador(tx, antesDe);
          r.notas += p.notas;
          r.eventos += p.eventos;
          r.inutilizacoes += p.inutilizacoes;
          r.recibos += p.recibos;
        });
        return { tenants, ...r, falhas };
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code !== FUNCAO_INEXISTENTE) throw e;
        // Sem a função, a lista não sai: nada foi apagado. A rodada conta como feita (um aviso por dia, não um erro a cada 15 min).
        d.log.warn({ rotina, pendente: 'plataforma.tenants_todos()' }, 'purga do simulador pendente: falta a função que lista todos os tenants');
        return { tenants: 0, ...r, falhas: 0, pendente: 1 };
      }
    },
  };
}
