/**
 * Payloads dos eventos `pedido.pedido.*@1` (T-0013 §8). Validados pelo Zod de `contracts` antes de ir à outbox.
 * Sem dado pessoal, exceto o retrato do cliente no `aprovado@1` (P9, o faturamento usa na nota). O texto livre do
 * motivo só vai quando o código é `outro`.
 */
import { createHash } from 'node:crypto';
import {
  EVENTOS, PedidoAprovado, type MotivoCancelamento, type MotivoRecusa, type NomeEventoPedido, type PedidoEventoBase, type PedidoFaturadoV1, type StatusPedido,
} from '../contracts';
import type { CondicaoPagamento } from '@macuxierp/cadastros/contracts';
import type { PedidoGravado, RepoPedidos } from './portas';
import type { NotaAutorizadaLida } from './leitores';

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

/** Payload do faturado@1 a partir da nota autorizada lida (T-0015). Pura. */
export function faturadoDaNota(nota: NotaAutorizadaLida, p: PedidoGravado, status: StatusPedido, anterior: StatusPedido | null): PedidoFaturadoV1 {
  if (nota.pedido_id !== p.id) throw new Error(`Nota do pedido ${nota.pedido_id} não pertence ao pedido ${p.id}`);
  const produtoDa = (sequencia: number): string => {
    const item = p.itens.find((i) => i.sequencia === sequencia);
    if (!item) throw new Error(`Item ${sequencia} da nota não existe no pedido ${p.id}`);
    return item.produto_id;
  };
  return {
    ...base({ ...p, status }, anterior),
    ambiente: nota.ambiente,
    ...(nota.conta_como_real === undefined ? {} : { conta_como_real: nota.conta_como_real }),
    nota: {
      id: nota.nota.id, numero: nota.nota.numero, serie: nota.nota.serie, chave: nota.nota.chave_acesso,
      emitida_em: nota.nota.emitida_em, total_centavos: nota.nota.total_centavos,
    },
    itens_faturados: nota.itens.map((i) => ({ sequencia: i.sequencia, produto_id: produtoDa(i.sequencia), quantidade: i.quantidade, valor_centavos: i.valor_centavos })),
  };
}

/** UUID determinístico (forma v5) do `faturado@1` de uma nota. Única fonte da regra do id derivado. */
export function idFaturadoDaNota(notaId: string): string {
  const h = createHash('sha1').update(`pedido.pedido.faturado@1:${notaId}`).digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x50;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Ids das notas já aplicadas ao pedido (têm o `pedido_evento` de id derivado), numa consulta só. */
export async function notasAplicadas(repo: Pick<RepoPedidos, 'eventosRegistrados'>, pedidoId: string, notaIds: string[]): Promise<Set<string>> {
  const porEvento = new Map(notaIds.map((n) => [idFaturadoDaNota(n), n]));
  const achados = await repo.eventosRegistrados(pedidoId, [...porEvento.keys()]);
  return new Set([...achados].map((e) => porEvento.get(e) as string));
}
