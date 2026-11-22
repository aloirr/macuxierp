import type { CondicaoPagamento } from '@macuxierp/cadastros/contracts';
import { CodigoPendencia, type CodigoRecusaRecebimento, type Pendencia, type PendenciaDetalhada } from '../contracts';
import { totalItem, valorItem, verificarItens, type ItemValor } from './valores';

export interface ItemAvaliacao extends ItemValor {
  produto_id: string;
}

/**
 * Retrato lido pelas portas na transação do chamador (T-0013 §3.1). Só inteiros: centavos, Qtd4 e pontos-base.
 * O preço entra já resolvido (`PrecoVigente`, com o recuo à filial padrão em `origem_filial_id`).
 */
export interface EntradaAvaliacao {
  cliente: { inativo: boolean; limite_credito_centavos: number };
  filial: { emissora: boolean; inativo: boolean };
  condicao_pagamento_id: string | null;
  /** Nulo = não encontrada (ou não informada). `forma_tpag` define se é à vista (`ehAVista`). */
  condicao: Pick<CondicaoPagamento, 'forma_tpag' | 'prazos_dias' | 'inativo'> | null;
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
}

/** Decisões de 21/11/2026 23h55 e 22/11 00h30: à vista = tPag 01, 17 ou 04 E todos os prazos_dias iguais a 0 ("PIX em 30 dias" não é à vista). */
export const FORMAS_A_VISTA = Object.freeze(['01', '17', '04'] as const);

export const ehAVista = (condicao: Pick<CondicaoPagamento, 'forma_tpag' | 'prazos_dias'>): boolean =>
  (FORMAS_A_VISTA as readonly string[]).includes(condicao.forma_tpag) && condicao.prazos_dias.every((d) => d === 0);

/** RN-PED-04; decisões de 21/11 23h10, 23h55 e 22/11 00h30: à vista fica fora da análise e do limite de crédito. */
export function avaliarCredito(a: {
  condicao: Pick<CondicaoPagamento, 'forma_tpag' | 'prazos_dias'> | null;
  limite_credito_centavos: number;
  titulos_abertos_centavos: number;
  compromisso_credito_centavos: number;
  total_centavos: number;
}): { codigo: 'credito_sem_limite' | 'credito_excedido'; esperado: number; informado: number } | null {
  if (a.condicao !== null && ehAVista(a.condicao)) return null;
  if (a.limite_credito_centavos === 0 && a.total_centavos > 0) return { codigo: 'credito_sem_limite', esperado: 0, informado: a.total_centavos };
  const exposicao = a.titulos_abertos_centavos + a.compromisso_credito_centavos + a.total_centavos;
  return exposicao > a.limite_credito_centavos ? { codigo: 'credito_excedido', esperado: a.limite_credito_centavos, informado: exposicao } : null;
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
  else if (e.condicao.inativo) r.push(pend('condicao_inativa', false));

  const credito = avaliarCredito({
    condicao: e.condicao,
    limite_credito_centavos: e.cliente.limite_credito_centavos,
    titulos_abertos_centavos: e.titulos_abertos_centavos,
    compromisso_credito_centavos: e.compromisso_credito_centavos,
    total_centavos: total,
  });
  if (credito) r.push(pend(credito.codigo, false, null, null, credito.esperado, credito.informado));

  // RN-CAD-07: estoque somado por produto (um item por produto não esconde a soma).
  const pedido = somarPorProduto(itens);
  const saldo = somarPorProduto(e.saldos);
  const comprometido = somarPorProduto(e.compromisso_estoque);
  for (const [produtoId, qtd] of pedido) {
    const livre = (saldo.get(produtoId) ?? 0) - (comprometido.get(produtoId) ?? 0);
    if (qtd > livre) r.push(pend('estoque_insuficiente', false, null, produtoId, Math.max(0, livre), qtd));
  }

  return ordenar(r);
}

const ordenar = (p: PendenciaDetalhada[]): PendenciaDetalhada[] =>
  p.sort((a, b) => CodigoPendencia.options.indexOf(a.codigo) - CodigoPendencia.options.indexOf(b.codigo) || (a.sequencia ?? 0) - (b.sequencia ?? 0));

type CodigoRecusaCadastro = Exclude<CodigoRecusaRecebimento, 'modulo_pedido_inativo'>;

/** Retrato do pedido do FDV lido pelas portas (cadastro apenas; nulo = não encontrado). */
export interface RetratoRecebimentoFdv {
  cliente: { inativo: boolean } | null;
  filial: { emissora: boolean; inativo: boolean } | null;
  /** Nulo = não encontrada; com `condicao_pagamento_id` nulo a recusa é `condicao_ausente`. */
  condicao: { inativo: boolean } | null;
  condicao_pagamento_id: string | null;
  produtos: readonly { id: string; inativo: boolean }[];
  itens: readonly (ItemValor & { produto_id: string })[];
}

export type DecisaoRecebimentoFdv = { resultado: 'aprovado' } | { resultado: 'recusado'; codigo: CodigoRecusaCadastro };

/**
 * Decisão de 21/11/2026, 23h10: o pedido do FDV entra aprovado; só problema de cadastro recusa o recebimento (a T-0016 devolve `rejeitado_erp`).
 * Premissas (c) e (d). Ordem: cliente, filial, condição, produto, item.
 */
export function decidirRecebimentoFdv(r: RetratoRecebimentoFdv): DecisaoRecebimentoFdv {
  const recusa = (codigo: CodigoRecusaCadastro): DecisaoRecebimentoFdv => ({ resultado: 'recusado', codigo });
  if (r.cliente === null) return recusa('cliente_inexistente');
  if (r.cliente.inativo) return recusa('cliente_inativo');
  if (r.filial === null) return recusa('filial_inexistente');
  if (!r.filial.emissora || r.filial.inativo) return recusa('filial_nao_emissora');
  // Decisão 23h55: pedido do FDV sem condição de pagamento é recusado.
  if (r.condicao_pagamento_id === null) return recusa('condicao_ausente');
  if (r.condicao === null) return recusa('condicao_inexistente');
  if (r.condicao.inativo) return recusa('condicao_inativa');
  const produtos = new Map(r.produtos.map((p) => [p.id, p]));
  if (r.itens.some((i) => !produtos.has(i.produto_id))) return recusa('produto_inexistente');
  if (r.itens.some((i) => produtos.get(i.produto_id)?.inativo)) return recusa('produto_inativo');
  if (verificarItens(r.itens).length > 0) return recusa('item_incoerente');
  return { resultado: 'aprovado' };
}
