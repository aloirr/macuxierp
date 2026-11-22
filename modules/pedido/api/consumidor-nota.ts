/**
 * Consumidor de `faturamento.nota.autorizada@1` (T-0015, lote 4a; RN-PED-02): soma a nota às quantidades faturadas do pedido,
 * leva o status a `faturado_parcial` ou `faturado` e publica `pedido.pedido.faturado@1`. Tudo na transação do evento: `FOR UPDATE`
 * no pedido, UPDATE, `pedido_evento` e outbox. Ator `sistema`. O recuo por `nota.cancelada@1` vem no lote 4b.
 *
 * Idempotência em duas camadas: o worker aplica no máximo uma vez por `(id do consumidor, evento.id)` e, por segurança, o
 * `faturado@1` leva id derivado do id da nota; se o histórico do pedido já tem esse `evento_id`, a nota não é somada de novo.
 *
 * Mensagem envenenada: o despachante do worker não tem limite de tentativas nem dead-letter, então lançar numa recusa
 * determinística (status inválido, sequência inexistente, acima do saldo) ou num payload fora do contrato repetiria o evento
 * para sempre e travaria as notas seguintes do mesmo agregado. Nesses casos o consumidor NÃO lança: loga em `error` (só ids e
 * códigos, regra 8), chama `alertar` e retorna, e o evento conta como consumido. O `pedido_evento` não recebe linha de anomalia
 * (o schema exige `para` do status do pedido), então o rastro é o log e o alerta. Só o erro transitório (banco, rede) sobe e é
 * repetido pelo despachante.
 */
import { createHash } from 'node:crypto';
import { criarEvento, type ConsumidorEvento, type Outbox, type Relogio } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_FATURADO, PedidoFaturadoV1 } from '../contracts';
import { aplicarNotaAutorizada } from '../domain';
import { faturadoDaNota } from './eventos';
import { NotaAutorizadaLida } from './leitores';
import type { Dependencias, LogPedido } from './portas';
import { repositorioSql } from './sql';

export const ID_CONSUMIDOR_NOTA_AUTORIZADA = 'pedido.nota-autorizada' as const;
export const EVENTO_NOTA_AUTORIZADA = 'faturamento.nota.autorizada@1' as const;

/** Alerta do monitor (mesma forma do `Alertar` do integracao-fdv, que o pedido não pode importar). Só ids e códigos no contexto. */
export type AlertarPedido = (tenantId: string, codigo: string, contexto?: Record<string, string>) => void;

/** Log do consumidor: o do pedido mais o nível `error`, usado nas recusas que alertam. */
export type LogConsumidorPedido = LogPedido & { error(dados: Record<string, unknown>, mensagem: string): void };

export interface DependenciasConsumidoresPedido {
  outbox: Outbox;
  relogio: Relogio;
  log?: LogConsumidorPedido;
  /** Alerta do monitor para recusa determinística e payload fora do contrato. Opcional: sem ele só há o log. */
  alertar?: AlertarPedido;
  /** Padrão: o adaptador SQL; os testes em memória passam o dublê. */
  repositorios?: Dependencias['repositorios'];
}

/** UUID determinístico (forma v5) do `faturado@1` de uma nota. */
export function idFaturadoDaNota(notaId: string): string {
  const h = createHash('sha1').update(`pedido.pedido.faturado@1:${notaId}`).digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x50;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function criarConsumidorNotaAutorizada(d: DependenciasConsumidoresPedido): ConsumidorEvento {
  const repositorios = d.repositorios ?? repositorioSql;
  return {
    id: ID_CONSUMIDOR_NOTA_AUTORIZADA,
    eventos: [EVENTO_NOTA_AUTORIZADA],
    async tratar(evento, tx) {
      const lida = NotaAutorizadaLida.safeParse(evento.payload);
      if (!lida.success) {
        // Não lança de propósito: o payload não vai melhorar numa repetição e lançar envenenaria a fila do agregado.
        d.log?.error({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, evento: evento.nome, codigo: 'nota_fora_do_contrato' }, 'nota autorizada fora do contrato');
        d.alertar?.(evento.tenant_id, 'nota_fora_do_contrato', { evento_id: evento.id });
        return;
      }
      const nota = lida.data;
      if (!nota.pedido_id) return;
      const repo = repositorios(tx);
      const pedido = await repo.obterParaAtualizar(nota.pedido_id);
      if (!pedido) {
        d.log?.warn({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, nota_id: nota.nota.id, pedido_id: nota.pedido_id, codigo: 'nota_de_pedido_inexistente' }, 'nota autorizada ignorada');
        return;
      }
      const eventoId = idFaturadoDaNota(nota.nota.id);
      if (await repo.eventoRegistrado(pedido.id, eventoId)) return;
      const r = aplicarNotaAutorizada(pedido.itens, nota.itens, pedido.status);
      if (!r.ok) {
        d.log?.error({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, nota_id: nota.nota.id, pedido_id: pedido.id, codigo: r.codigo }, 'nota autorizada recusada pelo pedido');
        d.alertar?.(evento.tenant_id, r.codigo, { pedido_id: pedido.id, nota_id: nota.nota.id, evento_id: evento.id });
        return;
      }
      const agora = d.relogio.agora();
      await repo.aplicarFaturamento(pedido.id, r.itens, pedido.valor_faturado_centavos + r.valor_centavos, r.status);
      await repo.registrarEvento({
        pedido_id: pedido.id, de: pedido.status, para: r.status, ator_tipo: 'sistema', ator_id: null, motivo_codigo: null, motivo_texto: null,
        pendencias: null, evento_id: eventoId, ocorrido_em: agora,
      });
      const payload = PedidoFaturadoV1.parse(faturadoDaNota(nota, pedido, r.status, pedido.status));
      await d.outbox.gravar(tx, criarEvento({
        nome: EVENTO_PEDIDO_FATURADO, tenant_id: evento.tenant_id, agregado_id: pedido.id, ator: 'sistema', request_id: evento.request_id, payload,
      }, agora, eventoId));
      d.log?.info({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, pedido_id: pedido.id, nota_id: nota.nota.id, status: r.status }, 'pedido faturado pela nota');
    },
  };
}

/** Consumidores do pedido para o worker ligar. Fase 4a: só a nota autorizada (o recuo por nota cancelada vem no lote 4b). */
export function consumidoresDoPedido(d: DependenciasConsumidoresPedido): ConsumidorEvento[] {
  return [criarConsumidorNotaAutorizada(d)];
}
