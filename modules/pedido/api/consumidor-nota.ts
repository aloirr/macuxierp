/**
 * Consumidor de `faturamento.nota.autorizada@1` (T-0015, lote 4a; RN-PED-02): soma a nota às quantidades faturadas do pedido,
 * leva o status a `faturado_parcial` ou `faturado` e publica `pedido.pedido.faturado@1`. Tudo na transação do evento: `FOR UPDATE`
 * no pedido, UPDATE, `pedido_evento` e outbox. Ator `sistema`. O recuo por `nota.cancelada@1` é o outro consumidor deste arquivo (lote 4b).
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
import { criarEvento, type ConsumidorEvento, type Outbox, type Relogio } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_FATURADO, PedidoFaturadoV1 } from '../contracts';
import { aplicarNotaAutorizada, MOTIVO_NOTA_CANCELADA, recuarPorNotaCancelada } from '../domain';
import { faturadoDaNota, idFaturadoDaNota, idRecuoDaNota, notasAplicadas } from './eventos';
import { NotaAutorizadaLida, NotaCanceladaLida } from './leitores';
import type { Dependencias, LogPedido } from './portas';
import { repositorioSql } from './sql';
import { RecuoRecusadoPeloBanco } from './util';

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

export function criarConsumidorNotaAutorizada(d: DependenciasConsumidoresPedido): ConsumidorEvento {
  const repositorios = d.repositorios ?? repositorioSql;
  return {
    id: ID_CONSUMIDOR_NOTA_AUTORIZADA,
    eventos: [EVENTO_NOTA_AUTORIZADA],
    async tratar(evento, tx) {
      const lida = NotaAutorizadaLida.safeParse(evento.payload);
      if (!lida.success) {
        // Não lança de propósito: o payload não vai melhorar numa repetição e lançar envenenaria a fila do agregado.
        d.log?.error({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, request_id: evento.request_id, evento: evento.nome, codigo: 'nota_fora_do_contrato' }, 'nota autorizada fora do contrato');
        d.alertar?.(evento.tenant_id, 'nota_fora_do_contrato', { evento_id: evento.id });
        return;
      }
      const nota = lida.data;
      if (!nota.pedido_id) return;
      const repo = repositorios(tx);
      const pedido = await repo.obterParaAtualizar(nota.pedido_id);
      if (!pedido) {
        d.log?.warn({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, request_id: evento.request_id, nota_id: nota.nota.id, pedido_id: nota.pedido_id, codigo: 'nota_de_pedido_inexistente' }, 'nota autorizada ignorada');
        return;
      }
      const eventoId = idFaturadoDaNota(nota.nota.id);
      if ((await notasAplicadas(repo, pedido.id, [nota.nota.id])).has(nota.nota.id)) return;
      const r = aplicarNotaAutorizada(pedido.itens, nota.itens, pedido.status);
      if (!r.ok) {
        d.log?.error({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, request_id: evento.request_id, nota_id: nota.nota.id, pedido_id: pedido.id, codigo: r.codigo }, 'nota autorizada recusada pelo pedido');
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
      d.log?.info({ tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, request_id: evento.request_id, pedido_id: pedido.id, nota_id: nota.nota.id, status: r.status }, 'pedido faturado pela nota');
    },
  };
}

export const ID_CONSUMIDOR_NOTA_CANCELADA = 'pedido.nota-cancelada' as const;
export const EVENTO_NOTA_CANCELADA = 'faturamento.nota.cancelada@1' as const;

/**
 * Consumidor de `faturamento.nota.cancelada@1` (T-0015, lote 4b; RN-PED-02): devolve ao pedido o que a nota cancelada tinha faturado
 * e recua o status (faturado → faturado_parcial | aprovado; faturado_parcial → aprovado). NÃO publica evento (nem `faturado@1`):
 * o rastro é o `pedido_evento` (ator `sistema`, motivo `nota_cancelada`) e o log. Mesma transação do evento, `FOR UPDATE` no pedido.
 *
 * Idempotência: a linha de histórico leva `idRecuoDaNota(nota.id)`. Só recua nota que foi aplicada antes (existe a linha
 * `idFaturadoDaNota`); se a cancelada chegou antes da autorizada, ou a autorizada foi recusada, alerta `nota_cancelada_sem_aplicacao`
 * e não mexe. Pedido cancelado depois do faturado_parcial que recebe nota cancelada gera o alerta `status_invalido` e não é alterado.
 * Recusa do domain e MXP02 do banco são definitivas (alerta, sem lançar); só erro transitório sobe e é repetido.
 */
export function criarConsumidorNotaCancelada(d: DependenciasConsumidoresPedido): ConsumidorEvento {
  const repositorios = d.repositorios ?? repositorioSql;
  return {
    id: ID_CONSUMIDOR_NOTA_CANCELADA,
    eventos: [EVENTO_NOTA_CANCELADA],
    async tratar(evento, tx) {
      const base = { tenant_id: evento.tenant_id, modulo: 'pedido', evento_id: evento.id, request_id: evento.request_id };
      const lida = NotaCanceladaLida.safeParse(evento.payload);
      if (!lida.success) {
        d.log?.error({ ...base, evento: evento.nome, codigo: 'nota_fora_do_contrato' }, 'nota cancelada fora do contrato');
        d.alertar?.(evento.tenant_id, 'nota_fora_do_contrato', { evento_id: evento.id });
        return;
      }
      const nota = lida.data;
      if (!nota.pedido_id) return;
      const repo = repositorios(tx);
      const pedido = await repo.obterParaAtualizar(nota.pedido_id);
      if (!pedido) {
        d.log?.warn({ ...base, nota_id: nota.nota.id, pedido_id: nota.pedido_id, codigo: 'nota_de_pedido_inexistente' }, 'nota cancelada ignorada');
        return;
      }
      const idRecuo = idRecuoDaNota(nota.nota.id);
      const achados = await repo.eventosRegistrados(pedido.id, [idRecuo, idFaturadoDaNota(nota.nota.id)]);
      if (achados.has(idRecuo)) return;
      const ctx = { pedido_id: pedido.id, nota_id: nota.nota.id, evento_id: evento.id };
      if (!achados.has(idFaturadoDaNota(nota.nota.id))) {
        d.log?.error({ ...base, ...ctx, codigo: 'nota_cancelada_sem_aplicacao' }, 'nota cancelada sem a autorizada aplicada ao pedido');
        d.alertar?.(evento.tenant_id, 'nota_cancelada_sem_aplicacao', ctx);
        return;
      }
      const r = recuarPorNotaCancelada(pedido.itens, nota.itens, pedido.status, pedido.valor_faturado_centavos);
      if (!r.ok) {
        d.log?.error({ ...base, ...ctx, codigo: r.codigo }, 'recuo por nota cancelada recusado pelo pedido');
        d.alertar?.(evento.tenant_id, r.codigo, ctx);
        return;
      }
      try {
        await repo.aplicarRecuo(pedido.id, r.itens, r.valor_faturado_centavos, r.status);
      } catch (e) {
        if (!(e instanceof RecuoRecusadoPeloBanco)) throw e;
        d.log?.error({ ...base, ...ctx, codigo: 'recuo_recusado_pelo_banco' }, 'recuo por nota cancelada recusado pelo banco');
        d.alertar?.(evento.tenant_id, 'recuo_recusado_pelo_banco', ctx);
        return;
      }
      await repo.registrarEvento({
        pedido_id: pedido.id, de: pedido.status, para: r.status, ator_tipo: 'sistema', ator_id: null, motivo_codigo: MOTIVO_NOTA_CANCELADA, motivo_texto: null,
        pendencias: null, evento_id: idRecuo, ocorrido_em: d.relogio.agora(),
      });
      d.log?.info({ ...base, pedido_id: pedido.id, nota_id: nota.nota.id, status: r.status }, 'pedido recuado pela nota cancelada');
    },
  };
}

/** Consumidores do pedido para o worker ligar: nota autorizada e nota cancelada. */
export function consumidoresDoPedido(d: DependenciasConsumidoresPedido): ConsumidorEvento[] {
  return [criarConsumidorNotaAutorizada(d), criarConsumidorNotaCancelada(d)];
}
