import { CodigoPendencia, type Pendencia, type PendenciaDetalhada } from '../contracts';
import { totalItem, valorItem, type ItemValor } from './valores';

export interface ItemAvaliacao extends ItemValor {
  produto_id: string;
  /** Só no pedido do FDV; nulo no manual. */
  total_informado_centavos: number | null;
}

/**
 * Retrato lido pelas portas na transação do chamador (T-0013 §3.1). Só inteiros: centavos, Qtd4 e pontos-base.
 * O preço entra já resolvido (`PrecoVigente`, com o recuo à filial padrão em `origem_filial_id`).
 */
export interface EntradaAvaliacao {
  cliente: { inativo: boolean; limite_credito_centavos: number };
  filial: { emissora: boolean; inativo: boolean };
  condicao_pagamento_id: string | null;
  /** Nulo = não encontrada (ou não informada). */
  condicao: { inativa: boolean } | null;
  itens: readonly ItemAvaliacao[];
  produtos: readonly { id: string; inativo: boolean }[];
  /** Preço de tabela vigente por produto; produto ausente = sem preço na tabela. */
  precos: readonly { produto_id: string; preco_centavos: number; desconto_maximo_bp: number; origem_filial_id: string }[];
  /** Saldo da filial do pedido; produto ausente = 0. */
  saldos: readonly { produto_id: string; quantidade: number }[];
  /** Qtd4 dos itens dos outros pedidos aprovados não faturados, na filial (P5). Sem o próprio pedido. */
  compromisso_estoque: readonly { produto_id: string; quantidade: number }[];
  titulos_abertos_centavos: number;
  /** Total não faturado dos outros pedidos aprovados do cliente (P5). Sem o próprio pedido. */
  compromisso_credito_centavos: number;
  total_informado_centavos: number | null;
}

/**
 * PR-1, premissa pendente com o Alexandre: limite de crédito 0 vale como "sem crédito" (RN-PED-04 literal).
 * Para trocar para "0 = sem limite", altere só esta função.
 */
export function creditoSemLimite(limiteCentavos: number, totalCentavos: number): boolean {
  return limiteCentavos === 0 && totalCentavos > 0;
}

const pend = (
  codigo: CodigoPendencia,
  bloqueante: boolean,
  sequencia: number | null = null,
  produto_id: string | null = null,
  esperado: number | null = null,
  informado: number | null = null,
): PendenciaDetalhada => ({ codigo, bloqueante, sequencia, produto_id, esperado, informado });

const somarPorProduto = (linhas: readonly { produto_id: string; quantidade: number }[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const l of linhas) m.set(l.produto_id, (m.get(l.produto_id) ?? 0) + l.quantidade);
  return m;
};

/** RN-PED-03 e RN-PED-04: as pendências sem os valores (o que vai no evento e no banco). */
export function avaliarPedido(e: EntradaAvaliacao): Pendencia[] {
  return avaliarPedidoDetalhado(e).map(({ esperado: _e, informado: _i, ...p }) => p);
}

/**
 * RN-PED-03 e RN-PED-04: devolve todas as pendências do pedido com `esperado` e `informado` (unidades em `PendenciaDetalhada`).
 * Lista vazia = aprova sozinho. Lança `EntradaIncoerente` se algum desconto passar do valor do item
 * (a API valida antes com `verificarItens`).
 */
export function avaliarPedidoDetalhado(e: EntradaAvaliacao): PendenciaDetalhada[] {
  const r: PendenciaDetalhada[] = [];
  const itens = e.itens.map((i, indice) => ({ ...i, total: totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, indice) }));
  const total = itens.reduce((s, i) => s + i.total, 0);

  if (e.cliente.inativo) r.push(pend('cliente_inativo', true));
  if (!e.filial.emissora || e.filial.inativo) r.push(pend('filial_nao_emissora', true));

  const inativos = new Set(e.produtos.filter((p) => p.inativo).map((p) => p.id));
  const precos = new Map(e.precos.map((p) => [p.produto_id, p]));
  for (const i of itens) {
    if (inativos.has(i.produto_id)) r.push(pend('produto_inativo', true, i.sequencia, i.produto_id));
  }
  for (const i of itens) {
    const preco = precos.get(i.produto_id);
    if (!preco) {
      r.push(pend('preco_sem_tabela', false, i.sequencia, i.produto_id));
      continue;
    }
    // RN-PED-03: desconto = max(0, valor de tabela − total do item); pendência se desconto/valor > máximo (em pontos-base).
    const valorTabela = valorItem(i.quantidade, preco.preco_centavos);
    const desconto = Math.max(0, valorTabela - i.total);
    if (BigInt(desconto) * 10_000n > BigInt(valorTabela) * BigInt(preco.desconto_maximo_bp)) {
      const aplicadoBp = Number((BigInt(desconto) * 10_000n) / BigInt(valorTabela));
      r.push(pend('desconto_acima_maximo', false, i.sequencia, i.produto_id, preco.desconto_maximo_bp, aplicadoBp));
    }
  }

  if (e.condicao_pagamento_id === null || e.condicao === null) r.push(pend('condicao_ausente', false));
  else if (e.condicao.inativa) r.push(pend('condicao_inativa', false));

  // RN-PED-04 (+ PR-1): títulos abertos + compromisso dos outros pedidos + este pedido ≤ limite.
  if (creditoSemLimite(e.cliente.limite_credito_centavos, total)) r.push(pend('credito_sem_limite', false, null, null, e.cliente.limite_credito_centavos, total));
  else {
    const exposicao = e.titulos_abertos_centavos + e.compromisso_credito_centavos + total;
    if (exposicao > e.cliente.limite_credito_centavos) r.push(pend('credito_excedido', false, null, null, e.cliente.limite_credito_centavos, exposicao));
  }

  // RN-CAD-07: estoque somado por produto (um item por produto não esconde a soma).
  const pedido = somarPorProduto(itens);
  const saldo = somarPorProduto(e.saldos);
  const comprometido = somarPorProduto(e.compromisso_estoque);
  for (const [produtoId, qtd] of pedido) {
    const livre = (saldo.get(produtoId) ?? 0) - (comprometido.get(produtoId) ?? 0);
    if (qtd > livre) r.push(pend('estoque_insuficiente', false, null, produtoId, Math.max(0, livre), qtd));
  }

  // Pedido do FDV: o ERP recalcula, e a diferença vira pendência.
  for (const i of itens) {
    if (i.total_informado_centavos !== null && i.total_informado_centavos !== i.total) {
      r.push(pend('total_divergente', false, i.sequencia, i.produto_id, i.total, i.total_informado_centavos));
    }
  }
  if (e.total_informado_centavos !== null && e.total_informado_centavos !== total) r.push(pend('total_divergente', false, null, null, total, e.total_informado_centavos));

  return ordenar(r);
}

const ordenar = (p: PendenciaDetalhada[]): PendenciaDetalhada[] =>
  p.sort((a, b) => CodigoPendencia.options.indexOf(a.codigo) - CodigoPendencia.options.indexOf(b.codigo) || (a.sequencia ?? 0) - (b.sequencia ?? 0));
