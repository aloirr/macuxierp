/**
 * Tradução do `PedidoParaErp` do Hub (já lido pelo `PedidoParaErpLido`) para a entrada da porta de recebimento do
 * pedido (T-0013 §5.2). Função pura: as chaves do Hub já resolvidas para UUID do ERP pela porta `ResolvedorChaveErp`
 * (ADR 0010, item 2) chegam em `ChavesResolvidas`; chave desconhecida rejeita com `*_inexistente`. RN-PED-01: `pedido_uuid` vira o `external_id` do pedido. Valores em centavos e Qtd4 (inteiros).
 */
import type { PedidoFdvEntrada, ResultadoRecebimentoFdv } from '@macuxierp/pedido/contracts';
import type { EntidadeChaveErp, PedidoParaErpLido } from '../contracts';

export type { PedidoFdvEntrada };
/** Código de recusa da porta de recebimento (contrato do pedido, RD-0241). */
export type CodigoRecusaRecebimento = Extract<ResultadoRecebimentoFdv, { resultado: 'recusado' }>['codigo'];

/** Chave do Hub -> UUID do ERP, por entidade, já resolvidos pela porta. Chave ausente no mapa = desconhecida. */
export interface ChavesResolvidas {
  cliente: ReadonlyMap<string, string>;
  vendedor: ReadonlyMap<string, string>;
  filial: ReadonlyMap<string, string>;
  produto: ReadonlyMap<string, string>;
  prazo_pagamento: ReadonlyMap<string, string>;
  /** Endereço de entrega `origem = erp` achado pela porta; chave não achada fica fora (o retrato segue, sem rejeitar). */
  cliente_endereco: ReadonlyMap<string, string>;
  /** `referencia` `filial_padrao`: vale quando o pedido não traz filial (ADR 0040 do FDV). */
  filialPadraoId: string | null;
}

export type CodigoRejeicaoPedido =
  | 'cliente_inexistente'
  | 'vendedor_inexistente'
  | 'filial_inexistente'
  | 'produto_inexistente'
  | 'condicao_inexistente'
  | 'sequencia_repetida'
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

/**
 * Endereço de entrega escolhido no cadastro do ERP, com a chave do Hub. Origem ausente vale `erp` (guia do Hub, A-01 da
 * T-0017); o `digitado` não tem chave; `external_id` nulo ou vazio = só os textos.
 */
function chaveDoEnderecoErp(p: PedidoParaErpLido): string | null {
  const e = p.endereco_entrega;
  const origem = e?.origem ?? 'erp';
  return e && origem === 'erp' && typeof e.external_id === 'string' && e.external_id.length > 0 ? e.external_id : null;
}

/** Chaves do pedido que a porta resolve, por entidade, sem repetição (uma consulta por entidade, RN-INF-05). */
export function chavesParaResolver(p: PedidoParaErpLido): Record<EntidadeChaveErp, string[]> {
  return {
    cliente: [p.cliente_external_id],
    vendedor: [p.vendedor_external_id],
    filial: p.filial?.external_id ? [p.filial.external_id] : [],
    produto: [...new Set(p.itens.map((i) => i.produto_external_id))],
    prazo_pagamento: p.pagamento?.prazo_external_id ? [p.pagamento.prazo_external_id] : [],
    cliente_endereco: chaveDoEnderecoErp(p) ? [chaveDoEnderecoErp(p)!] : [],
  };
}

/** Frete do Hub (`modalidade` CIF/FOB e retrato da transportadora) no formato do contrato do pedido; modalidade inválida = sem frete. */
function traduzirFrete(frete: Record<string, unknown> | null | undefined): PedidoFdvEntrada['frete'] {
  const modalidade = frete?.modalidade;
  if (modalidade !== 'CIF' && modalidade !== 'FOB') return null;
  const t = frete?.transportadora;
  return { modalidade, transportadora: t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : null };
}

export function traduzirPedido(p: PedidoParaErpLido, chaves: ChavesResolvidas): ResultadoTraducao {
  const cliente = chaves.cliente.get(p.cliente_external_id);
  if (!cliente) return { ok: false, codigo: 'cliente_inexistente' };
  const vendedor = chaves.vendedor.get(p.vendedor_external_id);
  if (!vendedor) return { ok: false, codigo: 'vendedor_inexistente' };
  const filialChave = p.filial?.external_id;
  const filial = filialChave ? chaves.filial.get(filialChave) : chaves.filialPadraoId;
  if (!filial) return { ok: false, codigo: 'filial_inexistente' };

  const vistas = new Set<number>();
  const itens: PedidoFdvEntrada['itens'] = [];
  for (const i of p.itens) {
    if (vistas.has(i.sequencia)) return { ok: false, codigo: 'sequencia_repetida' };
    vistas.add(i.sequencia);
    const produto = chaves.produto.get(i.produto_external_id);
    if (!produto) return { ok: false, codigo: 'produto_inexistente' };
    const quantidade = paraQtd4(i.quantidade);
    if (quantidade === null) return { ok: false, codigo: 'quantidade_invalida' };
    itens.push({
      sequencia: i.sequencia,
      produto_id: produto,
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

  // Sem prazo no pedido: `null`, e a porta `RecebedorPedidoFdv` recusa com `condicao_ausente`. Nunca procura por código.
  const prazoChave = p.pagamento?.prazo_external_id;
  let condicao: string | null = null;
  if (prazoChave) {
    condicao = chaves.prazo_pagamento.get(prazoChave) ?? null;
    if (!condicao) return { ok: false, codigo: 'condicao_inexistente' };
  }

  // Endereço não achado: `endereco_id` null, retrato mantido, sem rejeitar (T-0013 §5.2).
  const chaveEndereco = chaveDoEnderecoErp(p);
  const enderecoId = chaveEndereco ? (chaves.cliente_endereco.get(chaveEndereco) ?? null) : null;

  return {
    ok: true,
    entrada: {
      pedido_uuid: p.pedido_uuid,
      cliente_id: cliente,
      vendedor_id: vendedor,
      filial_id: filial,
      condicao_pagamento_id: condicao,
      emitido_em: new Date(p.criado_em).toISOString(),
      aprovado_origem_em: p.aprovado_em ? new Date(p.aprovado_em).toISOString() : null,
      observacao: p.observacao ?? null,
      frete: traduzirFrete(p.frete),
      endereco_entrega: p.endereco_entrega ? { endereco_id: enderecoId, retrato: p.endereco_entrega } : null,
      total_informado_centavos: p.total_cents,
      itens,
    },
  };
}
