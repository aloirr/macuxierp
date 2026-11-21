/**
 * Fila de `trabalho` (D10): reserva um lote dos tipos que este worker sabe executar, roda cada um na transação do
 * tenant dele e registra o desfecho. Falha = backoff até `maxTentativas` (padrão 5); depois, `falhou` e o `aoDesistir`
 * do executor numa transação própria. Erro que não melhora com o tempo (`ErroApi` 400, 403, 404 e 422 RN) desiste na
 * hora. Conflito (409), limite de taxa (429), indisponibilidade (503 da SEFAZ ou do Hub) e erro de infraestrutura
 * seguem o backoff.
 */
import { ErroApi, type Banco, type ExecutorTrabalho, type Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro, proximaTentativa, textoDoErro } from './backoff';
import type { ReservaTrabalhos } from './portas';

const MAX_TENTATIVAS_PADRAO = 5;
/** Status do `ErroApi` que desistem na hora: repetir não muda a resposta. */
const DESISTE_NA_HORA: ReadonlySet<number> = new Set([400, 403, 404, 422]);

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
        const negocio = e instanceof ErroApi && DESISTE_NA_HORA.has(e.status);
        const desiste = negocio || tentativas >= (executor.maxTentativas ?? MAX_TENTATIVAS_PADRAO);
        await d.fila.falhar(tx, t.id, tentativas, desiste ? null : proximaTentativa(d.relogio.agora(), tentativas), textoDoErro(e));
        if (desiste && executor.aoDesistir) {
          const aoDesistir = executor.aoDesistir.bind(executor);
          await d.banco.comTenant(t.tenant_id, (ttx) => aoDesistir(t, ttx)).catch((erro: unknown) => {
            d.log.error({ trabalho_id: t.id, tipo: t.tipo, tenant_id: t.tenant_id, erro: nomeDoErro(erro) }, 'aoDesistir do trabalho falhou');
          });
        }
        d.log.warn({ trabalho_id: t.id, tipo: t.tipo, tenant_id: t.tenant_id, tentativa: tentativas, desistiu: desiste, erro: nomeDoErro(e) }, 'trabalho falhou');
        if (desiste) resumo.desistidos++;
        else resumo.falhas++;
      }
    }
  });
  return resumo;
}
