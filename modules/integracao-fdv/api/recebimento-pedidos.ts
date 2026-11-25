/**
 * Busca e recebimento dos pedidos do FDV (RF-PED-01, RN-PED-01; T-0013 §5.1). Uma transação por pedido:
 * `INSERT ... ON CONFLICT` idempotente em `pedido_recebido`; tradução e porta num SAVEPOINT (a exceção desfaz só a
 * tradução e a porta, e a contagem de tentativas fica); com 5 tentativas o pedido vira `rejeitado` (`falha_interna`).
 * Nunca lê tabela do FDV: só a API do Hub, por `ClienteHubPedidos`. Log só com ids e códigos (LGPD).
 */
import { MARGEM_POSSE_AGENDA_MS, sha256Hex, type Banco, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { PedidoParaErpLido, type EntidadeChaveErp, type MotivoPausa } from '../contracts';
import { chavesParaResolver, traduzirPedido, type ChavesResolvidas, type CodigoRejeicao, type CodigoRejeicaoPedido } from '../domain/pedido-fdv';
import { jsonCanonico } from '../domain/canonico';
import { retornoRejeitadoErp } from '../domain/retorno-pedido';
import type { Alertar, ClienteHubPedidos, LogPedidos, RecebedorPedidoFdv, ResolvedorChaveErp } from './portas';
import { UMA_HORA_S, adiarPresoAPosse, adiarSinalSemLicenca, mais } from './conector-comum';
import { agendarRetorno, gravarRetorno, motivoDaRecusa } from './util-pedidos';

const LIMITE_BUSCA = 50;
export const MAX_TENTATIVAS = 5;

export interface DepsRecebimento {
  banco: Pick<Banco, 'comTenant'>;
  hub: ClienteHubPedidos;
  recebedor: RecebedorPedidoFdv;
  /** Implementação do `cadastros/api` (ADR 0010, item 2). */
  resolvedor: ResolvedorChaveErp;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
  /** Fim da posse da reserva da agenda: a busca para antes dele (`MARGEM_POSSE_AGENDA_MS`), como o envio de retornos. Sem ele não há trava. */
  posseAte?: Date;
}

export interface ResumoBusca {
  /** `imediata` = veio o lote cheio (50): buscar já; `pausa` = 401/403/426 (credencial); `desligada` = módulo pedido sem licença (a agenda adia 1 h). */
  proxima: 'imediata' | 'intervalo' | 'pausa' | 'desligada' | 'erro';
  buscados: number;
  entregues: number;
  rejeitados: number;
  repetidos: number;
  pendentes: number;
  /** `Retry-After` da última resposta não-200 do Hub (`proxima` = 'erro'): a agenda decide a espera. */
  retryAfterS?: number;
  /** Motivo da pausa quando `proxima` = 'pausa' (a agenda pausa o conector). */
  motivoPausa?: MotivoPausa;
  /** A busca parou antes do fim da posse: o que sobrou volta já (`proxima` = 'imediata'). */
  posseCurta?: boolean;
}

const UuidSo = z.object({ pedido_uuid: z.string().uuid() }).passthrough();
const sha256 = (v: unknown): string => sha256Hex(jsonCanonico(v));

async function resolverChaves(tx: Transacao, d: DepsRecebimento, tenantId: string, p: PedidoParaErpLido): Promise<ChavesResolvidas> {
  const pedidas = chavesParaResolver(p);
  const por = async (e: EntidadeChaveErp): Promise<Map<string, string>> =>
    pedidas[e].length ? d.resolvedor.resolver(tx, e, pedidas[e]) : new Map();
  // Uma chamada por entidade e por pedido; a filial padrão só é lida quando o pedido não traz filial.
  const [cliente, vendedor, filial, produto, prazo_pagamento, cliente_endereco] = [await por('cliente'), await por('vendedor'), await por('filial'), await por('produto'), await por('prazo_pagamento'), await por('cliente_endereco')];
  let filialPadraoId: string | null = null;
  if (!p.filial?.external_id) {
    const padrao = await tx.consultar<{ erp_id: string }>(
      `SELECT erp_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'filial_padrao' AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );
    filialPadraoId = padrao[0]?.erp_id ?? null;
  }
  return { cliente, vendedor, filial, produto, prazo_pagamento, cliente_endereco, filialPadraoId };
}

async function rejeitar(tx: Transacao, d: DepsRecebimento, tenantId: string, uuid: string, codigo: CodigoRejeicao, detalhe?: string, motivoDaRecusa?: string): Promise<void> {
  const agora = d.relogio.agora();
  await tx.consultar(
    `UPDATE integracao_fdv.pedido_recebido SET estado = 'rejeitado', erro_codigo = $3
      WHERE tenant_id = $1 AND pedido_uuid = $2`,
    [tenantId, uuid, codigo],
  );
  const corpo = retornoRejeitadoErp(uuid, codigo, agora, motivoDaRecusa);
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
         SET recebido_em = now(), tentativas = integracao_fdv.pedido_recebido.tentativas + 1
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
    const chaves = await resolverChaves(tx, d, tenantId, guardado.data);
    const trad = traduzirPedido(guardado.data, chaves);
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
      await rejeitar(tx, d, tenantId, pedidoUuid, r.codigo, undefined, 'motivo' in r ? r.motivo : undefined);
      await tx.consultar('RELEASE SAVEPOINT sp_pedido_fdv');
      return 'rejeitado';
    }
    await tx.consultar(
      `UPDATE integracao_fdv.pedido_recebido SET estado = 'entregue', pedido_id = $3, erro_codigo = NULL
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
  const curta = (): boolean => d.posseAte != null && d.relogio.agora().getTime() >= d.posseAte.getTime() - MARGEM_POSSE_AGENDA_MS;
  if (curta()) return { ...resumo, proxima: 'imediata', posseCurta: true };
  const resp = await d.hub.pendentes(LIMITE_BUSCA);
  const motivoPausa = motivoDaRecusa(resp.status, resp.codigo);
  if (motivoPausa) return { ...resumo, proxima: 'pausa', motivoPausa };
  if (resp.status < 200 || resp.status >= 300 || !resp.pedidos) {
    d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', http: resp.status }, 'busca de pedidos no Hub falhou');
    return { ...resumo, proxima: 'erro', ...(resp.retryAfterS != null ? { retryAfterS: resp.retryAfterS } : {}) };
  }
  resumo.buscados = resp.pedidos.length;
  for (const bruto of resp.pedidos) {
    // posse quase vencida: o resto fica no Hub (continua pendente lá) e a busca volta já
    if (curta()) return { ...resumo, proxima: 'imediata', posseCurta: true };
    const desfecho = await d.banco.comTenant(tenantId, (tx) => processar(tx, d, tenantId, bruto));
    if (desfecho === 'entregue') resumo.entregues++;
    else if (desfecho === 'rejeitado') resumo.rejeitados++;
    else if (desfecho === 'repetido') resumo.repetidos++;
    else if (desfecho === 'pendente') resumo.pendentes++;
    else if (desfecho === 'desligar') {
      // Sem licença do `pedido`: alerta e para; o pedido segue `recebido` (T-0013 §5.3). A própria busca adia a coluna em 1 h
      // (presa à posse, se houver; incondicional sem ela), então o resultado não depende de quem a chama; volta sozinha com a licença.
      d.alertar(tenantId, 'recebimento_pedidos_desligado');
      const para = mais(d.relogio.agora(), UMA_HORA_S);
      await d.banco.comTenant(tenantId, (tx) => (d.posseAte ? adiarPresoAPosse(tx, tenantId, { sinal: 'proxima_busca_pedidos_em' }, d.posseAte, para) : adiarSinalSemLicenca(tx, tenantId, 'proxima_busca_pedidos_em', para)));
      return { ...resumo, proxima: 'desligada' };
    }
  }
  if (resumo.buscados >= LIMITE_BUSCA) resumo.proxima = 'imediata';
  return resumo;
}
