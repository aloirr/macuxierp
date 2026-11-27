/**
 * Reentrega na partida do worker (T-0045). A `plataforma.evento_consumido` registra `(consumidor, evento)`, mas não é
 * cursor: o despachante só lê evento sem `publicado_em`, então o consumidor ligado depois de um evento publicado nunca o
 * recebe (ex.: `pedido.pedido.aprovado@1` dos pedidos aprovados antes da ligação do faturamento).
 *
 * Na partida, para cada consumidor e cada nome que ele consome dentro de `eventos` (padrão `EVENTOS_REENTREGA_PADRAO`),
 * relê os publicados sem falha terminal e sem linha de consumo dele e entrega por `aplicarAoConsumidor` (o caminho do
 * despachante). Idempotente: a linha de consumo exclui o evento, e o UNIQUE `(consumidor, evento_id)` segura duas partidas
 * ao mesmo tempo. Só tabelas `plataforma.*` (regra 1).
 *
 * Falha de um evento: log (só ids e nome do erro, regra 8), segue para o próximo e fica para a próxima partida (a
 * reentrega não mexe em `tentativas` nem em `erro` do evento, que são do despachante). Erro de infraestrutura na leitura
 * sobe para quem chamou (o worker loga e segue para o laço).
 */
import type { Banco, ConsumidorEvento, Relogio } from '@macuxierp/platform-sdk';
import type { Logger } from 'pino';
import { nomeDoErro } from './backoff';
import { aplicarAoConsumidor } from './despachante';
import type { FonteReentrega, RegistroConsumo } from './portas';

/** Eventos relidos na partida. Só os que um consumidor novo precisa ver desde o início. */
export const EVENTOS_REENTREGA_PADRAO: readonly string[] = Object.freeze([
  'pedido.pedido.aprovado@1',
  // Carga do fim da 0077 publicada sem consumo pelo worker da v0.3.23 no rollback de 27/11 (v0.3.25).
  'core.empresa.cnpj_alterado@1',
]);
/** Teto de falhas por (consumidor, evento) numa rodada: acima disso a rodada daquele par para (fica para a próxima partida). */
const MAX_FALHAS_POR_RODADA = 1_000;

export interface DependenciasReentrega {
  banco: Banco;
  fonte: FonteReentrega;
  consumo: RegistroConsumo;
  consumidores: readonly ConsumidorEvento[];
  relogio: Relogio;
  log: Logger;
  /** Padrão `EVENTOS_REENTREGA_PADRAO`. */
  eventos?: readonly string[];
  lote?: number;
}

export interface ResumoReentrega {
  entregues: number;
  falhas: number;
}

export async function reentregarPublicados(d: DependenciasReentrega): Promise<ResumoReentrega> {
  const resumo: ResumoReentrega = { entregues: 0, falhas: 0 };
  const eventos = d.eventos ?? EVENTOS_REENTREGA_PADRAO;
  const lote = d.lote ?? 100;
  for (const consumidor of d.consumidores) {
    for (const nome of consumidor.eventos.filter((n) => eventos.includes(n))) {
      const falhados: string[] = [];
      let entregues = 0;
      for (;;) {
        const pagina = await d.banco.semTenant((tx) => d.fonte.pendentes(tx, consumidor.id, nome, falhados, lote));
        if (pagina.length === 0) break;
        for (const evento of pagina) {
          try {
            await aplicarAoConsumidor(d, consumidor, evento);
            entregues++;
          } catch (e) {
            falhados.push(evento.id);
            d.log.warn({ consumidor: consumidor.id, evento: nome, evento_id: evento.id, tenant_id: evento.tenant_id, erro: nomeDoErro(e) }, 'reentrega falhou');
          }
        }
        if (falhados.length >= MAX_FALHAS_POR_RODADA) break;
      }
      resumo.entregues += entregues;
      resumo.falhas += falhados.length;
      if (entregues + falhados.length > 0) d.log.info({ consumidor: consumidor.id, evento: nome, entregues, falhas: falhados.length }, 'reentrega na partida');
    }
  }
  return resumo;
}
