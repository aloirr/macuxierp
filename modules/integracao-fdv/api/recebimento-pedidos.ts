/**
 * Busca e recebimento dos pedidos do FDV (RF-PED-01, RN-PED-01; T-0013 §5.1). Uma transação por pedido:
 * `INSERT ... ON CONFLICT` idempotente em `pedido_recebido`; tradução e porta num SAVEPOINT (a exceção desfaz só a
 * tradução e a porta, e a contagem de tentativas fica); com 5 tentativas o pedido vira `rejeitado` (`falha_interna`).
 * Nunca lê tabela do FDV: só a API do Hub, por `ClienteHubPedidos`. Log só com ids e códigos (LGPD).
 */
import { sha256Hex, type Banco, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { PedidoParaErpLido } from '../contracts';
import { chavesDaCondicao, traduzirPedido, type CodigoRejeicaoPedido, type Espelho } from '../domain/pedido-fdv';
import { canonico, retornoRejeitadoErp } from '../domain/retorno-pedido';
import type { Alertar, ClienteHubPedidos, LogPedidos, RecebedorPedidoFdv } from './portas';
import { agendarRetorno, credencialRecusada, gravarRetorno } from './util-pedidos';

const LIMITE_BUSCA = 50;
export const MAX_TENTATIVAS = 5;

export interface DepsRecebimento {
  banco: Banco;
  hub: ClienteHubPedidos;
  recebedor: RecebedorPedidoFdv;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
}

export interface ResumoBusca {
  /** `imediata` = veio o lote cheio (50): buscar já; `pausa` = 401/403/426 (credencial); `desligada` = módulo pedido sem licença. */
  proxima: 'imediata' | 'intervalo' | 'pausa' | 'desligada' | 'erro';
  buscados: number;
  entregues: number;
  rejeitados: number;
  repetidos: number;
  pendentes: number;
}

const UuidSo = z.object({ pedido_uuid: z.string().uuid() }).passthrough();
const sha256 = (v: unknown): string => sha256Hex(canonico(v));

async function carregarEspelho(tx: Transacao, tenantId: string, p: PedidoParaErpLido): Promise<Espelho> {
  const { prazoId: condicaoId, codigoErp } = chavesDaCondicao(p);
  // Confirmado no Hub = hash_confirmado (RN-INF-05). Pedido do FDV chega aprovado: inativo no ERP é recusa do pedido (rejeitado_erp com motivo), nunca análise nem reaprovação.
  const linhas = await tx.consultar<{ entidade: string; id: string; codigo: string | null }>(
    `SELECT entidade, registro_external_id AS id, payload->>'codigo' AS codigo
       FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND deleted_at IS NULL AND confirmado_em IS NOT NULL
        AND ((entidade = 'cliente' AND registro_external_id = $2)
          OR (entidade = 'vendedor' AND registro_external_id = $3)
          OR (entidade = 'produto' AND registro_external_id = ANY($4::text[]))
          OR (entidade = 'prazo_pagamento' AND (registro_external_id = $5 OR payload->>'codigo' = $6)))`,
    [tenantId, p.cliente_external_id, p.vendedor_external_id, p.itens.map((i) => i.produto_external_id), condicaoId, codigoErp],
  );
  const ids = (e: string) => new Set(linhas.filter((l) => l.entidade === e).map((l) => l.id));
  const padrao = await tx.consultar<{ erp_id: string }>(
    `SELECT erp_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'filial_padrao' AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  );
  const prazos = linhas.filter((l) => l.entidade === 'prazo_pagamento');
  return {
    clientes: ids('cliente'),
    vendedores: ids('vendedor'),
    produtos: ids('produto'),
    filialPadraoId: padrao[0]?.erp_id ?? null,
    condicoes: new Set(prazos.map((l) => l.id)),
    condicaoPorCodigo: new Map(prazos.filter((l) => l.codigo).map((l) => [l.codigo as string, l.id])),
  };
}

async function rejeitar(tx: Transacao, d: DepsRecebimento, tenantId: string, uuid: string, codigo: string, detalhe?: string): Promise<void> {
  const agora = d.relogio.agora();
  await tx.consultar(
    `UPDATE integracao_fdv.pedido_recebido SET estado = 'rejeitado', erro_codigo = $3, updated_at = now()
      WHERE tenant_id = $1 AND pedido_uuid = $2`,
    [tenantId, uuid, codigo],
  );
  const corpo = retornoRejeitadoErp(uuid, codigo, agora);
  const motivo = detalhe ? `${corpo.motivo}: ${detalhe}`.slice(0, 300) : corpo.motivo;
  await gravarRetorno(tx, tenantId, { ...corpo, motivo }, agora);
}

type Desfecho = 'entregue' | 'rejeitado' | 'repetido' | 'pendente' | 'desligar';

async function processar(tx: Transacao, d: DepsRecebimento, tenantId: string, bruto: unknown): Promise<Desfecho | 'ignorado'> {
  const uuid = UuidSo.safeParse(bruto);
  if (!uuid.success) {
    d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', codigo: 'pedido_sem_uuid' }, 'pedido do Hub sem uuid: ignorado');
    d.alertar(tenantId, 'pedido_sem_uuid');
    return 'ignorado';
  }
  const pedidoUuid = uuid.data.pedido_uuid;
  const lido = PedidoParaErpLido.safeParse(bruto);
  // `tentativa` muda a cada entrega do Hub: fica fora do hash e do payload guardado.
  const { tentativa: _t, ...semTentativa } = uuid.data as Record<string, unknown>;
  void _t;
  const hash = sha256(semTentativa);
  const agora = d.relogio.agora();

  const linha = (
    await tx.consultar<{ estado: string; tentativas: number; hash: string; payload: unknown }>(
      `INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, tentativas)
       VALUES ($1, $2, $3::jsonb, $4, 1)
       ON CONFLICT (tenant_id, pedido_uuid) DO UPDATE
         SET recebido_em = now(), tentativas = integracao_fdv.pedido_recebido.tentativas + 1, updated_at = now()
       RETURNING estado, tentativas, hash, payload`,
      [tenantId, pedidoUuid, JSON.stringify(lido.success ? semTentativa : { pedido_uuid: pedidoUuid }), hash],
    )
  )[0]!;

  // Linha ainda `recebido` reprocessada com conteúdo novo: vale o primeiro payload e o primeiro hash (o ON CONFLICT não os
  // troca). Por coerência, traduz-se o payload guardado, não o recebido agora.
  const guardado = linha.estado === 'recebido' && linha.payload ? PedidoParaErpLido.safeParse(linha.payload) : lido;

  if (linha.estado === 'entregue') {
    if (linha.hash !== hash) d.alertar(tenantId, 'pedido_fdv_conteudo_divergente', { pedido_uuid: pedidoUuid });
    await agendarRetorno(tx, tenantId, agora);
    return 'repetido';
  }
  if (linha.estado === 'rejeitado') {
    await agendarRetorno(tx, tenantId, agora);
    return 'repetido';
  }

  if (!guardado.success) {
    // Ao FDV vai só o nome dos campos, nunca o valor (como o Conector, T-0048 do FDV).
    const campos = [...new Set(guardado.error.issues.map((i) => String(i.path[0] ?? 'raiz')))].slice(0, 10).join(', ');
    await rejeitar(tx, d, tenantId, pedidoUuid, 'pedido_fora_do_contrato', campos);
    d.alertar(tenantId, 'pedido_fdv_fora_do_contrato', { pedido_uuid: pedidoUuid });
    return 'rejeitado';
  }

  await tx.consultar('SAVEPOINT sp_pedido_fdv');
  try {
    const espelho = await carregarEspelho(tx, tenantId, guardado.data);
    const trad = traduzirPedido(guardado.data, espelho);
    if (!trad.ok) {
      await rejeitar(tx, d, tenantId, pedidoUuid, trad.codigo satisfies CodigoRejeicaoPedido);
      await tx.consultar('RELEASE SAVEPOINT sp_pedido_fdv');
      return 'rejeitado';
    }
    const r = await d.recebedor.receber(tx, trad.entrada);
    if (r.resultado === 'recusado') {
      if (r.codigo === 'modulo_pedido_inativo') {
        await tx.consultar('RELEASE SAVEPOINT sp_pedido_fdv');
        return 'desligar'; // fica `recebido`; a busca desliga
      }
      await rejeitar(tx, d, tenantId, pedidoUuid, r.codigo);
      await tx.consultar('RELEASE SAVEPOINT sp_pedido_fdv');
      return 'rejeitado';
    }
    await tx.consultar(
      `UPDATE integracao_fdv.pedido_recebido SET estado = 'entregue', pedido_id = $3, erro_codigo = NULL, updated_at = now()
        WHERE tenant_id = $1 AND pedido_uuid = $2`,
      [tenantId, pedidoUuid, r.pedido_id],
    );
    await tx.consultar('RELEASE SAVEPOINT sp_pedido_fdv');
    return 'entregue';
  } catch (e) {
    await tx.consultar('ROLLBACK TO SAVEPOINT sp_pedido_fdv');
    // Só o tipo do erro: a mensagem pode carregar valor do pedido (LGPD).
    d.log.error(
      { tenant_id: tenantId, modulo: 'integracao-fdv', pedido_uuid: pedidoUuid, tentativas: linha.tentativas, erro: e instanceof Error ? e.name : 'erro' },
      'falha ao receber pedido do FDV',
    );
    if (linha.tentativas >= MAX_TENTATIVAS) {
      await rejeitar(tx, d, tenantId, pedidoUuid, 'falha_interna');
      d.alertar(tenantId, 'pedido_fdv_falha_interna', { pedido_uuid: pedidoUuid });
      return 'rejeitado';
    }
    return 'pendente';
  }
}

/** Uma busca no Hub e o recebimento de cada pedido, numa transação por pedido. */
export async function buscarPedidosPendentes(d: DepsRecebimento, tenantId: string): Promise<ResumoBusca> {
  const resumo: ResumoBusca = { proxima: 'intervalo', buscados: 0, entregues: 0, rejeitados: 0, repetidos: 0, pendentes: 0 };
  const resp = await d.hub.pendentes(LIMITE_BUSCA);
  if (credencialRecusada(resp.status)) return { ...resumo, proxima: 'pausa' };
  if (resp.status !== 200 || !resp.pedidos) {
    d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', http: resp.status }, 'busca de pedidos no Hub falhou');
    return { ...resumo, proxima: 'erro' };
  }
  resumo.buscados = resp.pedidos.length;
  for (const bruto of resp.pedidos) {
    const desfecho = await d.banco.comTenant(tenantId, (tx) => processar(tx, d, tenantId, bruto));
    if (desfecho === 'entregue') resumo.entregues++;
    else if (desfecho === 'rejeitado') resumo.rejeitados++;
    else if (desfecho === 'repetido') resumo.repetidos++;
    else if (desfecho === 'pendente') resumo.pendentes++;
    else if (desfecho === 'desligar') {
      // Sem licença do `pedido`: desliga a agenda e alerta; o pedido segue `recebido` (T-0013 §5.3).
      await d.banco.comTenant(tenantId, (tx) =>
        tx.consultar(`UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = NULL, updated_at = now() WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
      );
      d.alertar(tenantId, 'recebimento_pedidos_desligado');
      return { ...resumo, proxima: 'desligada' };
    }
  }
  if (resumo.buscados >= LIMITE_BUSCA) resumo.proxima = 'imediata';
  return resumo;
}
