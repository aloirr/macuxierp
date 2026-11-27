/**
 * T-0057 (LGPD, ADR 0014 §3): de hora em hora, enfileira o `cadastros.entrada_expurgo` (executor do cadastros, #775) em cada tenant ativo
 * com o `cadastros` licenciado. O `external_id` é a hora UTC (`expurgo:AAAA-MM-DDTHH`): a mesma hora não duplica, mesmo com dois workers.
 * O executor zera o corpo do lote parado há mais de 24 h; aqui só se agenda. Falha num tenant não para os outros; o log leva só o tenant
 * e o nome do erro.
 */
import { TRABALHO_ENTRADA_EXPURGO } from '@macuxierp/cadastros/api';
import { moduloLicenciado, type Banco, type FilaDeTrabalhos, type FonteLicencas, type Transacao } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import type { RotinaPeriodica } from './rotinas';
import { nomeDoErro } from './backoff';

export const ROTINA_EXPURGO_ENTRADA = 'cadastros.entrada_expurgo';
export const INTERVALO_EXPURGO_ENTRADA_MS = 3_600_000;

export interface DependenciasExpurgoEntrada {
  banco: Banco;
  log: Pick<Logger, 'warn'>;
  fila: FilaDeTrabalhos;
  licencas: FonteLicencas;
  tenantsAtivos: (tx: Transacao) => Promise<string[]>;
}

export function criarRotinaExpurgoEntrada(d: DependenciasExpurgoEntrada): RotinaPeriodica {
  return {
    id: ROTINA_EXPURGO_ENTRADA,
    intervaloMs: INTERVALO_EXPURGO_ENTRADA_MS,
    async executar(agora) {
      const r = { tenants: 0, enfileirados: 0, falhas: 0 };
      const external_id = `expurgo:${agora.toISOString().slice(0, 13)}`;
      for (const tenant_id of await d.banco.semTenant(d.tenantsAtivos)) {
        r.tenants++;
        try {
          const enfileirou = await d.banco.comTenant(tenant_id, async (tx) => {
            if (!moduloLicenciado(await d.licencas.ler(tx, tenant_id), 'cadastros', agora)) return false;
            await d.fila.enfileirar(tx, { tipo: TRABALHO_ENTRADA_EXPURGO, tenant_id, payload: {}, external_id });
            return true;
          });
          if (enfileirou) r.enfileirados++;
        } catch (e) {
          r.falhas++;
          d.log.warn({ rotina: ROTINA_EXPURGO_ENTRADA, tenant_id, erro: nomeDoErro(e) }, 'expurgo da entrada não foi agendado no tenant');
        }
      }
      return r;
    },
  };
}
