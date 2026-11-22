/**
 * Despachante da outbox (desenho T-0002, seção 5; contrato `.coord/contratos/eventos.md`):
 * - lê um lote de `plataforma.evento` em ordem de `ocorrido_em`;
 * - entrega cada evento a todo consumidor inscrito no nome, na transação do tenant do evento, uma vez só por
 *   `(consumidor, evento)` (`plataforma.evento_consumido`, gravado na mesma transação do efeito);
 * - todos ok = `publicado_em`; algum falhou = `tentativas`+1 e `proximo_em` com backoff, e os eventos seguintes do
 *   mesmo agregado no lote esperam (a ordem por agregado não se quebra);
 * - evento sem consumidor é marcado publicado.
 */
import type { Banco, ConsumidorEvento, Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro, proximaTentativa, textoDoErro } from './backoff';
import type { EventoPendente, FilaOutbox, RegistroConsumo } from './portas';

export interface DependenciasDespachante {
  banco: Banco;
  fila: FilaOutbox;
  consumo: RegistroConsumo;
  consumidores: readonly ConsumidorEvento[];
  relogio: Relogio;
  log: Logger;
  lote?: number;
}

export interface ResumoDespacho {
  publicados: number;
  falhas: number;
  adiados: number;
}

export async function despacharOutbox(d: DependenciasDespachante): Promise<ResumoDespacho> {
  const resumo: ResumoDespacho = { publicados: 0, falhas: 0, adiados: 0 };
  await d.banco.semTenant(async (tx) => {
    const agora = d.relogio.agora();
    const eventos = await d.fila.reservar(tx, d.lote ?? 100, agora);
    const travados = new Set<string>();
    for (const evento of eventos) {
      if (travados.has(evento.agregado_id)) {
        resumo.adiados++;
        continue;
      }
      const erro = await entregar(d, evento);
      if (erro === null) {
        await d.fila.marcarPublicado(tx, evento.id, d.relogio.agora());
        resumo.publicados++;
      } else {
        const tentativas = evento.tentativas + 1;
        await d.fila.marcarFalha(tx, evento.id, tentativas, proximaTentativa(d.relogio.agora(), tentativas), textoDoErro(erro));
        travados.add(evento.agregado_id);
        resumo.falhas++;
      }
    }
  });
  return resumo;
}

/** Entrega a cada consumidor inscrito; devolve o primeiro erro ou `null`. Consumidores que já aplicaram são pulados. */
async function entregar(d: DependenciasDespachante, evento: EventoPendente): Promise<unknown> {
  const log = d.log.child({ evento_id: evento.id, evento: evento.nome, tenant_id: evento.tenant_id, request_id: evento.request_id });
  let primeiroErro: unknown = null;
  for (const consumidor of d.consumidores.filter((c) => c.eventos.includes(evento.nome))) {
    try {
      await d.banco.comTenant(evento.tenant_id, async (tx) => {
        if (await d.consumo.jaConsumido(tx, consumidor.id, evento.id)) return;
        await consumidor.tratar(evento, tx);
        await d.consumo.registrar(tx, consumidor.id, evento.id, d.relogio.agora());
      });
    } catch (e) {
      log.warn({ consumidor: consumidor.id, tentativa: evento.tentativas + 1, erro: nomeDoErro(e) }, 'consumidor falhou');
      primeiroErro ??= e;
    }
  }
  return primeiroErro;
}
