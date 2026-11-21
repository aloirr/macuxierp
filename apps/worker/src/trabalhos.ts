/**
 * Fila de `trabalho` (D10): reserva um lote dos tipos que este worker sabe executar, roda cada um na transação do
 * tenant dele e registra o desfecho. Falha = backoff até `maxTentativas` (padrão 5); depois, `falhou`.
 */
import type { Banco, ExecutorTrabalho, Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro, proximaTentativa, textoDoErro } from './backoff';
import type { ReservaTrabalhos } from './portas';

const MAX_TENTATIVAS_PADRAO = 5;

export interface DependenciasTrabalhos {
  banco: Banco;
  fila: ReservaTrabalhos;
  executores: readonly ExecutorTrabalho[];
  relogio: Relogio;
  log: Logger;
  lote?: number;
}

export interface ResumoTrabalhos {
  concluidos: number;
  falhas: number;
  desistidos: number;
}

export async function processarTrabalhos(d: DependenciasTrabalhos): Promise<ResumoTrabalhos> {
  const resumo: ResumoTrabalhos = { concluidos: 0, falhas: 0, desistidos: 0 };
  const porTipo = new Map(d.executores.map((e) => [e.tipo, e]));
  if (porTipo.size === 0) return resumo;
  await d.banco.semTenant(async (tx) => {
    for (const t of await d.fila.reservar(tx, [...porTipo.keys()], d.lote ?? 20, d.relogio.agora())) {
      const executor = porTipo.get(t.tipo);
      if (!executor) continue; // a reserva filtra por tipo; defesa contra adaptador errado
      try {
        const resultado = await d.banco.comTenant(t.tenant_id, (ttx) => executor.executar(t, ttx));
        await d.fila.concluir(tx, t.id, resultado, d.relogio.agora());
        resumo.concluidos++;
      } catch (e) {
        const tentativas = t.tentativas + 1;
        const desiste = tentativas >= (executor.maxTentativas ?? MAX_TENTATIVAS_PADRAO);
        await d.fila.falhar(tx, t.id, tentativas, desiste ? null : proximaTentativa(d.relogio.agora(), tentativas), textoDoErro(e));
        d.log.warn({ trabalho_id: t.id, tipo: t.tipo, tenant_id: t.tenant_id, tentativa: tentativas, desistiu: desiste, erro: nomeDoErro(e) }, 'trabalho falhou');
        if (desiste) resumo.desistidos++;
        else resumo.falhas++;
      }
    }
  });
  return resumo;
}
