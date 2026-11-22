/**
 * Payloads dos eventos `pedido.pedido.*@1` (T-0013 §8). Validados pelo Zod de `contracts` antes de ir à outbox.
 * Sem dado pessoal, exceto o retrato do cliente no `aprovado@1` (P9, o faturamento usa na nota). O texto livre do
 * motivo só vai quando o código é `outro`.
 */
import {
  EVENTOS, PedidoAprovado, type MotivoCancelamento, type MotivoRecusa, type NomeEventoPedido, type PedidoEventoBase, type StatusPedido,
} from '../contracts';
import type { CondicaoPagamento } from '@macuxierp/cadastros/contracts';
import type { PedidoGravado } from './portas';

/** Condição lida na aprovação; só os campos que o evento leva. */
export type CondicaoDoEvento = Pick<CondicaoPagamento, 'forma_tpag' | 'forma_codigo' | 'forma_nome'> | null;

export interface EventoPronto {
  nome: NomeEventoPedido;
  agregado_id: string;
  payload: Record<string, unknown>;
}

const base = (p: PedidoGravado, anterior: StatusPedido | null): PedidoEventoBase => ({
  pedido_id: p.id,
  numero: p.numero,
  origem: p.origem,
  pedido_uuid: p.origem === 'fdv' ? p.external_id : null,
  status: p.status,
  status_anterior: anterior,
  filial_id: p.filial_id,
  cliente_id: p.cliente_id,
  vendedor_id: p.vendedor_id,
  total_centavos: p.total_centavos,
});

const pronto = (nome: NomeEventoPedido, p: PedidoGravado, payload: unknown): EventoPronto => ({
  nome,
  agregado_id: p.id,
  payload: EVENTOS[nome].parse(payload) as Record<string, unknown>,
});

/** O pedido inteiro, para o faturamento montar a fila "a faturar" (T-0013 §8.1). */
const pedidoAprovado = (p: PedidoGravado, condicao: CondicaoDoEvento = null): PedidoAprovado =>
  PedidoAprovado.parse({
    condicao_pagamento_id: p.condicao_pagamento_id,
    forma_tpag: condicao?.forma_tpag ?? null,
    forma_codigo: condicao?.forma_codigo ?? null,
    forma_nome: condicao?.forma_nome ?? null,
    tabela_preco_id: p.tabela_preco_id,
    emitido_em: p.emitido_em,
    observacao: p.observacao,
    cliente_retrato: p.cliente_retrato,
    endereco_entrega: p.endereco_entrega,
    frete: p.frete,
    total_centavos: p.total_centavos,
    itens: p.itens.map((i) => ({
      sequencia: i.sequencia,
      produto_id: i.produto_id,
      produto_retrato: i.produto_retrato,
      quantidade: i.quantidade,
      preco_unitario_centavos: i.preco_unitario_centavos,
      desconto_centavos: i.desconto_centavos,
      total_centavos: i.total_centavos,
    })),
  });

/** `p.status` já é o status resultante da decisão automática (P8); `anterior` é nulo na criação. */
export const eventoRecebido = (p: PedidoGravado): EventoPronto => pronto('pedido.pedido.recebido@1', p, { ...base(p, null), pendencias: p.pendencias.map((x) => x.codigo) });

export const eventoAprovado = (p: PedidoGravado, anterior: StatusPedido, automatica: boolean, condicao: CondicaoDoEvento): EventoPronto =>
  pronto('pedido.pedido.aprovado@1', p, { ...base(p, anterior), automatica, pedido: pedidoAprovado(p, condicao) });

const textoDoMotivo = (codigo: string, texto: string | null): string | null => (codigo === 'outro' ? texto : null);

export const eventoRecusado = (p: PedidoGravado, anterior: StatusPedido, codigo: MotivoRecusa, texto: string | null): EventoPronto =>
  pronto('pedido.pedido.recusado@1', p, { ...base(p, anterior), motivo_codigo: codigo, motivo_texto: textoDoMotivo(codigo, texto) });

export const eventoCancelado = (p: PedidoGravado, anterior: StatusPedido, codigo: MotivoCancelamento, texto: string | null): EventoPronto =>
  pronto('pedido.pedido.cancelado@1', p, { ...base(p, anterior), motivo_codigo: codigo, motivo_texto: textoDoMotivo(codigo, texto) });
