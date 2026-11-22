/**
 * Tradução do `PedidoParaErp` do Hub (já lido pelo `PedidoParaErpLido`) para a entrada da porta de recebimento do
 * pedido (T-0013 §5.2). Função pura: o que depende do espelho (cliente, vendedor, produto, filial padrão, condição) chega
 * pronto em `Espelho`. RN-PED-01: `pedido_uuid` vira o `external_id` do pedido. Valores em centavos e Qtd4 (inteiros).
 */
import type { PedidoFdvEntrada, ResultadoRecebimentoFdv } from '@macuxierp/pedido/contracts';
import type { PedidoParaErpLido } from '../contracts';

export type { PedidoFdvEntrada };
/** Código de recusa da porta de recebimento (contrato do pedido, RD-0241). */
export type CodigoRecusaRecebimento = Extract<ResultadoRecebimentoFdv, { resultado: 'recusado' }>['codigo'];

/** Ids que o espelho confirmou (RN-INF-05: só o que o ERP publicou entra) e as referências para filial e condição. */
export interface Espelho {
  clientes: ReadonlySet<string>;
  vendedores: ReadonlySet<string>;
  produtos: ReadonlySet<string>;
  filialPadraoId: string | null;
  /** `prazo_pagamento.codigo` do ERP -> id da condição. */
  condicaoPorCodigo: ReadonlyMap<string, string>;
  /** Ids de condição conhecidos no espelho (para validar `prazo_external_id`). */
  condicoes: ReadonlySet<string>;
}

export type CodigoRejeicaoPedido =
  | 'cliente_desconhecido'
  | 'vendedor_desconhecido'
  | 'produto_desconhecido'
  | 'sequencia_repetida'
  | 'filial_desconhecida'
  | 'quantidade_invalida'
  | 'pedido_fora_do_contrato';

/** Todo código que vira `rejeitado_erp`: recusa da porta, tradução local ou falha interna. */
export type CodigoRejeicao = CodigoRejeicaoPedido | CodigoRecusaRecebimento | 'falha_interna';

type ResultadoTraducao = { ok: true; entrada: PedidoFdvEntrada } | { ok: false; codigo: CodigoRejeicaoPedido };

/** Decimal (número ou texto) para Qtd4, sem float no texto; `null` se não for positivo. */
export function paraQtd4(valor: number | string): number | null {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(n)) return null;
  const q = Math.round(n * 10_000);
  return Number.isSafeInteger(q) && q > 0 ? q : null;
}

function opcionalQtd4(valor: number | string | null | undefined): number | null {
  return valor === null || valor === undefined ? null : paraQtd4(valor);
}

/** Chaves da condição de pagamento do pedido: id do prazo no espelho e código do ERP (RN-INF-05). */
export function chavesDaCondicao(p: PedidoParaErpLido): { prazoId: string | null; codigoErp: string | null } {
  return {
    prazoId: p.pagamento?.prazo_external_id ?? null,
    codigoErp: p.pagamento?.condicao_pagamento_erp ?? p.condicao_pagamento_erp ?? null,
  };
}

/** Frete do Hub (`modalidade` CIF/FOB e retrato da transportadora) no formato do contrato do pedido; modalidade inválida = sem frete. */
function traduzirFrete(frete: Record<string, unknown> | null | undefined): PedidoFdvEntrada['frete'] {
  const modalidade = frete?.modalidade;
  if (modalidade !== 'CIF' && modalidade !== 'FOB') return null;
  const t = frete?.transportadora;
  return { modalidade, transportadora: t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : null };
}

export function traduzirPedido(p: PedidoParaErpLido, espelho: Espelho): ResultadoTraducao {
  if (!espelho.clientes.has(p.cliente_external_id)) return { ok: false, codigo: 'cliente_desconhecido' };
  if (!espelho.vendedores.has(p.vendedor_external_id)) return { ok: false, codigo: 'vendedor_desconhecido' };
  const filial = p.filial?.external_id ?? espelho.filialPadraoId;
  if (!filial) return { ok: false, codigo: 'filial_desconhecida' };

  const vistas = new Set<number>();
  const itens: PedidoFdvEntrada['itens'] = [];
  for (const i of p.itens) {
    if (vistas.has(i.sequencia)) return { ok: false, codigo: 'sequencia_repetida' };
    vistas.add(i.sequencia);
    if (!espelho.produtos.has(i.produto_external_id)) return { ok: false, codigo: 'produto_desconhecido' };
    const quantidade = paraQtd4(i.quantidade);
    if (quantidade === null) return { ok: false, codigo: 'quantidade_invalida' };
    itens.push({
      sequencia: i.sequencia,
      produto_id: i.produto_external_id,
      quantidade,
      unidade_venda: i.unidade ?? null,
      fator_venda: opcionalQtd4(i.fator),
      quantidade_venda: opcionalQtd4(i.quantidade_venda),
      preco_unitario_centavos: i.preco_unitario_cents,
      desconto_centavos: i.desconto_cents ?? 0,
      total_informado_centavos: i.total_cents,
      aplicacao: i.aplicacao ?? null,
    });
  }

  const { prazoId: prazo, codigoErp } = chavesDaCondicao(p);
  const condicao =
    prazo && espelho.condicoes.has(prazo) ? prazo : codigoErp ? (espelho.condicaoPorCodigo.get(codigoErp) ?? null) : null;

  return {
    ok: true,
    entrada: {
      pedido_uuid: p.pedido_uuid,
      cliente_id: p.cliente_external_id,
      vendedor_id: p.vendedor_external_id,
      filial_id: filial,
      condicao_pagamento_id: condicao,
      emitido_em: new Date(p.criado_em).toISOString(),
      aprovado_origem_em: p.aprovado_em ? new Date(p.aprovado_em).toISOString() : null,
      observacao: p.observacao ?? null,
      frete: traduzirFrete(p.frete),
      endereco_entrega: p.endereco_entrega ? { endereco_id: null, retrato: p.endereco_entrega } : null,
      total_informado_centavos: p.total_cents,
      itens,
    },
  };
}
