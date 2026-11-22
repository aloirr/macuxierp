/**
 * Retorno do status do pedido ao Hub (RN-PED-05; T-0013 §6). O consumidor `integracao-fdv.retorno-pedido` grava o
 * retorno de forma idempotente (`retorno_enviado`); o envio roda pela agenda `sinal.proximo_retorno_em`, em ordem
 * por pedido. Sem XML e sem dado pessoal em log ou alerta (só código e uuid do pedido).
 */
import type { Banco, ConsumidorEvento, EnvelopeEvento, Relogio } from '@macuxierp/platform-sdk';
import type { RetornoErp, StatusRetornoHub } from '../contracts';
import { EVENTOS_DE_RETORNO, PayloadPedidoLido, retornoDoPedido } from '../domain/retorno-pedido';
import type { Alertar, ClienteHubPedidos, LogPedidos } from './portas';
import { codigoSeguro, credencialRecusada, gravarRetorno } from './util-pedidos';

export function criarConsumidorRetornoPedido(deps: { log: LogPedidos; relogio: Relogio }): ConsumidorEvento {
  return {
    id: 'integracao-fdv.retorno-pedido',
    eventos: EVENTOS_DE_RETORNO,
    async tratar(evento: EnvelopeEvento, tx) {
      const payload = PayloadPedidoLido.safeParse(evento.payload);
      if (!payload.success) {
        deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', evento: evento.nome, codigo: 'payload_fora_do_contrato' }, 'evento de pedido ignorado');
        return;
      }
      const uuid = payload.data.pedido_uuid;
      if (payload.data.origem !== 'fdv' || !uuid) return;
      const recebido = await tx.consultar(
        `SELECT 1 FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2 AND deleted_at IS NULL`,
        [evento.tenant_id, uuid],
      );
      if (recebido.length === 0) {
        deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'pedido_nao_recebido_pelo_conector' }, 'evento de pedido sem pedido_recebido');
        return;
      }
      const ultimo = await tx.consultar<{ status: StatusRetornoHub }>(
        `SELECT status FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1 AND pedido_uuid = $2 AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [evento.tenant_id, uuid],
      );
      const decisao = retornoDoPedido({ nome: evento.nome, ocorrido_em: evento.ocorrido_em, payload: payload.data }, ultimo[0]?.status ?? null);
      if (decisao.acao === 'enviar') await gravarRetorno(tx, evento.tenant_id, decisao.corpo, deps.relogio.agora());
    },
  };
}

export interface DepsEnvioRetorno {
  banco: Banco;
  hub: ClienteHubPedidos;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
}
export interface ResumoEnvio {
  enviados: number;
  falhou: number;
  reagendados: number;
  /** 401/403/426: a credencial pausa o conector. */
  pausa: boolean;
}

/** Curva do Hub: 5 s, 10 s, 20 s... até 15 min; respeita `Retry-After` quando for maior. */
export function esperaDoRetorno(tentativas: number, retryAfterS?: number): number {
  const curva = Math.min(5_000 * 2 ** Math.max(0, tentativas - 1), 15 * 60_000);
  return Math.max(curva, (retryAfterS ?? 0) * 1000);
}

const RODADAS_MAX = 20;
const LOTE = 50;

export async function enviarRetornosPendentes(d: DepsEnvioRetorno, tenantId: string): Promise<ResumoEnvio> {
  const r: ResumoEnvio = { enviados: 0, falhou: 0, reagendados: 0, pausa: false };
  for (let rodada = 0; rodada < RODADAS_MAX; rodada++) {
    // A cabeça da fila de cada pedido: um retorno pendente antigo do mesmo pedido segura os seguintes.
    const fila = await d.banco.comTenant(tenantId, (tx) =>
      tx.consultar<{ id: string; pedido_uuid: string; corpo: RetornoErp; tentativas: number }>(
        `SELECT r.id, r.pedido_uuid, r.corpo, r.tentativas FROM integracao_fdv.retorno_enviado r
          WHERE r.tenant_id = $1 AND r.estado = 'pendente' AND r.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM integracao_fdv.retorno_enviado a
                             WHERE a.tenant_id = r.tenant_id AND a.pedido_uuid = r.pedido_uuid AND a.estado = 'pendente'
                               AND a.deleted_at IS NULL AND (a.created_at, a.id) < (r.created_at, r.id))
          ORDER BY r.created_at, r.id LIMIT $2`,
        [tenantId, LOTE],
      ),
    );
    if (fila.length === 0) {
      await d.banco.comTenant(tenantId, (tx) =>
        // Só zera se nada ficou pendente: um retorno gravado depois da leitura da fila não perde o wakeup.
        tx.consultar(
          `UPDATE integracao_fdv.sinal SET proximo_retorno_em = NULL, updated_at = now()
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1 AND estado = 'pendente' AND deleted_at IS NULL)`,
          [tenantId],
        ),
      );
      return r;
    }
    let progresso = false;
    for (const item of fila) {
      const resp = await d.hub.enviarRetorno(item.pedido_uuid, item.corpo);
      const agora = d.relogio.agora();
      if (credencialRecusada(resp.status, resp.codigo)) return { ...r, pausa: true };
      if (resp.status >= 200 && resp.status < 300) {
        const descartados = resp.itens_descartados ?? [];
        await d.banco.comTenant(tenantId, (tx) =>
          tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET estado = 'enviado', enviado_em = $3, resposta_http = $4,
                    itens_descartados = $5::jsonb, tentativas = tentativas + 1, updated_at = now()
              WHERE tenant_id = $1 AND id = $2`,
            [tenantId, item.id, agora, resp.status, descartados.length ? JSON.stringify(descartados) : null],
          ),
        );
        if (descartados.length) d.alertar(tenantId, 'retorno_itens_descartados', { pedido_uuid: item.pedido_uuid });
        r.enviados++;
        progresso = true;
      } else if (resp.status === 0 || resp.status === 429 || resp.status >= 500) {
        const espera = esperaDoRetorno(item.tentativas + 1, resp.retryAfterS);
        await d.banco.comTenant(tenantId, async (tx) => {
          await tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET tentativas = tentativas + 1, resposta_http = $3, updated_at = now()
              WHERE tenant_id = $1 AND id = $2`,
            [tenantId, item.id, resp.status === 0 ? null : resp.status],
          );
          await tx.consultar(
            `UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2, updated_at = now() WHERE tenant_id = $1 AND deleted_at IS NULL`,
            [tenantId, new Date(agora.getTime() + espera)],
          );
        });
        d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', pedido_uuid: item.pedido_uuid, http: resp.status, espera_ms: espera }, 'retorno ao Hub reagendado');
        r.reagendados++;
        return r; // Hub fora do ar: não adianta insistir nos outros agora
      } else {
        // 422 (e demais 4xx): definitivo. Só o código do Hub vai ao monitor.
        await d.banco.comTenant(tenantId, (tx) =>
          tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET estado = 'falhou', resposta_http = $3, tentativas = tentativas + 1, updated_at = now()
              WHERE tenant_id = $1 AND id = $2`,
            [tenantId, item.id, resp.status],
          ),
        );
        d.alertar(tenantId, 'retorno_recusado_pelo_hub', { pedido_uuid: item.pedido_uuid, codigo: codigoSeguro(resp.codigo, resp.status) });
        r.falhou++;
        progresso = true;
      }
    }
    if (!progresso) return r;
  }
  return r;
}
