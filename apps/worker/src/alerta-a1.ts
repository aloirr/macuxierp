/**
 * Alerta diário do certificado A1 (RF-CORE-04): todo certificado ativo a 30 dias ou menos de vencer (ou já vencido,
 * RN-CORE-06) gera um aviso no BKO da filial, uma vez por certificado e por dia (UTC). Idempotente: rodar de novo no
 * mesmo dia não duplica. O log leva só contagens, `tenant_id` e o nome do erro; nunca titular, CNPJ nem o certificado.
 */
import { alertaVencimento, diasParaVencer } from '@macuxierp/core/api';
import { DIAS_ALERTA_A1 } from '@macuxierp/core/contracts';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { DIA_MS, paraCadaTenant, type RotinaDiaria } from './rotinas';

export interface CertificadoVencendo {
  id: string;
  filial_id: string;
  valido_ate: Date;
}

export interface AvisoA1 {
  certificado_id: string;
  filial_id: string;
  valido_ate: Date;
  dias: number;
  /** `AAAA-MM-DD` em UTC: com o `certificado_id`, a chave de idempotência do aviso. */
  dia: string;
}

/** Tenants ativos (roda em `semTenant`). Adaptador pendente: função do banco que lista só os ids (pedido ao banco-dados). */
export interface FonteTenants {
  ativos(tx: Transacao): Promise<string[]>;
}

/**
 * Certificados ativos do tenant da transação com `valido_ate < limite` (exclusivo; adaptador do core, na RLS do tenant).
 * A fonte pode trazer a mais: a rotina confere cada um com `alertaVencimento` do core.
 */
export interface FonteCertificados {
  vencendoAte(tx: Transacao, limite: Date): Promise<CertificadoVencendo[]>;
}

/** Aviso do BKO (selo no `GET /v1/auth/eu`). Devolve `false` quando o aviso do dia já existia. */
export interface DestinoAvisos {
  registrarA1(tx: Transacao, aviso: AvisoA1): Promise<boolean>;
}

export interface DependenciasAlertaA1 {
  banco: Banco;
  tenants: FonteTenants;
  certificados: FonteCertificados;
  avisos: DestinoAvisos;
  log: Logger;
  /** Hora UTC da rodada (padrão 11 h UTC = 7 h em Manaus). */
  horaUtc?: number;
}

export function criarRotinaAlertaA1(d: DependenciasAlertaA1): RotinaDiaria {
  return {
    id: 'core.alerta_a1',
    horaUtc: d.horaUtc ?? 11,
    async executar(agora) {
      const resumo = { avisos: 0, repetidos: 0 };
      const dia = agora.toISOString().slice(0, 10);
      // Com o floor da RN-CORE-06, "30 dias ou menos" vale para tudo abaixo de 31 dias: limite exclusivo em agora + 31 d.
      const limite = new Date(agora.getTime() + (DIAS_ALERTA_A1 + 1) * DIA_MS);
      // Um tenant com problema não segura os outros; a rodada seguinte (ou o reinício) tenta de novo.
      const { tenants, falhas } = await paraCadaTenant(d.banco, (tx) => d.tenants.ativos(tx), 'core.alerta_a1', d.log, async (tx) => {
        for (const c of await d.certificados.vencendoAte(tx, limite)) {
          if (!alertaVencimento(c.valido_ate, agora)) continue;
          const novo = await d.avisos.registrarA1(tx, { certificado_id: c.id, filial_id: c.filial_id, valido_ate: c.valido_ate, dias: diasParaVencer(c.valido_ate, agora), dia });
          if (novo) resumo.avisos++;
          else resumo.repetidos++;
        }
      });
      return { tenants, ...resumo, falhas };
    },
  };
}
