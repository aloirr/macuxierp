/**
 * Despachante da outbox (desenho T-0002, seção 5; contrato `.coord/contratos/eventos.md`):
 * - lê um lote de `plataforma.evento` em ordem de `ocorrido_em`;
 * - entrega cada evento a todo consumidor inscrito no nome, na transação do tenant do evento, uma vez só por
 *   `(consumidor, evento)` (`plataforma.evento_consumido`, gravado na mesma transação do efeito);
 * - todos ok = `publicado_em`; algum falhou = `tentativas`+1 e `proximo_em` com backoff, e os eventos seguintes do
 *   mesmo agregado no lote esperam (a ordem por agregado não se quebra);
 * - limite de tentativas (T-0045, padrão 10): na última falha, estado terminal `falhou` com alerta `evento_falhou` e o
 *   agregado liberado. Regras: `.coord/contratos/eventos.md`, "Entrega, limite de tentativas e reentrega";
 * - evento sem consumidor é marcado publicado.
 */
import type { Banco, ConsumidorEvento, EnvelopeEvento, Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro, proximaTentativa, textoDoErro } from './backoff';
import type { AlertarWorker, EventoPendente, FilaOutbox, RegistroConsumo } from './portas';

/** Tentativas por evento antes do estado terminal `falhou`. */
export const MAX_TENTATIVAS_OUTBOX = 10;
/** Início do `erro` do evento no estado terminal (publicado, mas não aplicado por algum consumidor). */
export const PREFIXO_FALHOU = 'falhou: ';
export const ALERTA_EVENTO_FALHOU = 'evento_falhou';

export interface DependenciasDespachante {
  banco: Banco;
  fila: FilaOutbox;
  consumo: RegistroConsumo;
  consumidores: readonly ConsumidorEvento[];
  relogio: Relogio;
  log: Logger;
  lote?: number;
  /** Padrão `MAX_TENTATIVAS_OUTBOX`. */
  maxTentativas?: number;
  /** Alerta do monitor no estado terminal; sem ele, só o log `error`. */
  alertar?: AlertarWorker;
}

export interface ResumoDespacho {
  publicados: number;
  falhas: number;
  adiados: number;
  /** Eventos que chegaram ao estado terminal `falhou` neste lote. */
  desistidos: number;
}

export async function despacharOutbox(d: DependenciasDespachante): Promise<ResumoDespacho> {
  const resumo: ResumoDespacho = { publicados: 0, falhas: 0, adiados: 0, desistidos: 0 };
  const max = d.maxTentativas ?? MAX_TENTATIVAS_OUTBOX;
  await d.banco.semTenant(async (tx) => {
    const agora = d.relogio.agora();
    const eventos = await d.fila.reservar(tx, d.lote ?? 100, agora);
    const travados = new Set<string>();
    for (const evento of eventos) {
      if (travados.has(evento.agregado_id)) {
        resumo.adiados++;
        continue;
      }
      const falha = await entregar(d, evento);
      if (falha === null) {
        await d.fila.marcarPublicado(tx, evento.id, d.relogio.agora());
        resumo.publicados++;
        continue;
      }
      const tentativas = evento.tentativas + 1;
      if (tentativas >= max) {
        await d.fila.marcarFalhou(tx, evento.id, tentativas, d.relogio.agora(), `${PREFIXO_FALHOU}${textoDoErro(falha.erro)}`.slice(0, 500));
        d.log.error(
          { evento_id: evento.id, evento: evento.nome, tenant_id: evento.tenant_id, consumidor: falha.consumidor, tentativas, erro: nomeDoErro(falha.erro) },
          'evento falhou: limite de tentativas',
        );
        d.alertar?.(evento.tenant_id, ALERTA_EVENTO_FALHOU, { evento_id: evento.id, consumidor: falha.consumidor });
        resumo.desistidos++;
      } else {
        await d.fila.marcarFalha(tx, evento.id, tentativas, proximaTentativa(d.relogio.agora(), tentativas), textoDoErro(falha.erro));
        travados.add(evento.agregado_id);
        resumo.falhas++;
      }
    }
  });
  return resumo;
}

/**
 * Aplica o evento a um consumidor na transação do tenant do evento, uma vez só por `(consumidor, evento)`: pula quem já
 * aplicou e registra o consumo junto com o efeito. Lança o erro do consumidor (a transação volta inteira). Caminho único
 * do despachante e da reentrega (`reentrega.ts`).
 */
export async function aplicarAoConsumidor(
  d: Pick<DependenciasDespachante, 'banco' | 'consumo' | 'relogio'>,
  consumidor: ConsumidorEvento,
  evento: EnvelopeEvento,
): Promise<void> {
  await d.banco.comTenant(evento.tenant_id, async (tx) => {
    if (await d.consumo.jaConsumido(tx, consumidor.id, evento.id)) return;
    await consumidor.tratar(evento, tx);
    await d.consumo.registrar(tx, consumidor.id, evento.id, d.relogio.agora());
  });
}

/** Entrega a cada consumidor inscrito; devolve o primeiro erro (e de quem) ou `null`. */
async function entregar(d: DependenciasDespachante, evento: EventoPendente): Promise<{ erro: unknown; consumidor: string } | null> {
  const log = d.log.child({ evento_id: evento.id, evento: evento.nome, tenant_id: evento.tenant_id, request_id: evento.request_id });
  let primeira: { erro: unknown; consumidor: string } | null = null;
  for (const consumidor of d.consumidores.filter((c) => c.eventos.includes(evento.nome))) {
    try {
      await aplicarAoConsumidor(d, consumidor, evento);
    } catch (e) {
      log.warn({ consumidor: consumidor.id, tentativa: evento.tentativas + 1, erro: nomeDoErro(e) }, 'consumidor falhou');
      primeira ??= { erro: e, consumidor: consumidor.id };
    }
  }
  return primeira;
}
