/**
 * Rotina diária `integracao-fdv.expurgo-pre-cadastro` (T-0059, RN-INF-06, LGPD): o registro no laço das rotinas diárias do worker. A regra
 * (corte de 180 dias; recusado e sem decisão, T-0098) e a auditoria (só contagens) são do módulo e do banco: `expurgarPreCadastro` do
 * `integracao-fdv` calcula o corte e chama `integracao_fdv.expurgar_pre_cadastro(p_corte)` na transação de cada tenant ativo
 * (papel `macuxierp_worker`, RLS). Aqui só entram o horário, a lista de tenants (adaptador SQL do core) e o relógio da rodada.
 * Idempotente: rodar de novo no mesmo dia não apaga nada a mais. O log leva só contagens, `tenant_id` e o nome do erro.
 */
import { fonteTenantsSql } from '@macuxierp/core/api';
import { expurgarPreCadastro, ROTINA_EXPURGO_PRE_CADASTRO, type DepsExpurgoPreCadastro } from '@macuxierp/integracao-fdv/api';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import type { RotinaDiaria } from './rotinas';

export interface DependenciasExpurgoPreCadastro {
  banco: Banco;
  log: Pick<Logger, 'info' | 'warn'>;
  /** Padrão: `plataforma.tenants_ativos()` (adaptador SQL do core). */
  tenantsAtivos?: (tx: Transacao) => Promise<string[]>;
  /** Hora UTC da rodada (padrão 8 h UTC = 4 h em Manaus, fora do expediente). */
  horaUtc?: number;
}

export function criarRotinaExpurgoPreCadastro(d: DependenciasExpurgoPreCadastro): RotinaDiaria {
  return {
    id: ROTINA_EXPURGO_PRE_CADASTRO,
    horaUtc: d.horaUtc ?? 8,
    async executar(agora) {
      const deps: DepsExpurgoPreCadastro = {
        banco: d.banco,
        tenantsAtivos: d.tenantsAtivos ?? ((tx) => fonteTenantsSql.ativos(tx)),
        relogio: { agora: () => agora },
        log: { info: (obj, msg) => d.log.info(obj, msg), warn: (obj, msg) => d.log.warn(obj, msg) },
      };
      return expurgarPreCadastro(deps);
    },
  };
}
