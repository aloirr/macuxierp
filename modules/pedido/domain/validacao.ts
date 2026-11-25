import { classeForma, prazoCompleto, prazoPermitidoAoCliente, type CondicaoPagamento } from '@macuxierp/cadastros/contracts';
import { CodigoPendencia, type CodigoRecusaRecebimento, type Pendencia, type PendenciaDetalhada } from '../contracts';
import { verificarFracaoDosItens } from './fracao';
import { totalItem, valorItem, verificarItens, type ItemValor } from './valores';

export interface ItemAvaliacao extends ItemValor {
  produto_id: string;
}

/** A condição inteira: a RN-PED-07 precisa do código, da descrição, das parcelas, do prazo médio e da forma (exceção do cartão). */
export type CondicaoParaAvaliar = Pick<CondicaoPagamento, 'codigo' | 'descricao' | 'prazos_dias' | 'prazo_medio_dias' | 'forma_tpag' | 'inativo'>;

/**
 * Retrato lido pelas portas na transação do chamador (T-0013 §3.1). Só inteiros: centavos, Qtd4 e pontos-base.
 * O preço entra já resolvido (`PrecoVigente`, com o recuo à filial padrão em `origem_filial_id`).
 */
export interface EntradaAvaliacao {
  cliente: { inativo: boolean; limite_credito_centavos: number; /** RN-CAD-16: nulo ou ausente = sem limite de prazo. */ prazo_medio_dias?: number | null };
  filial: { emissora: boolean; inativo: boolean };
  condicao_pagamento_id: string | null;
  /** Nulo = não encontrada (ou não informada). `forma_tpag` define se está fora do crédito (`foraDoCredito`). */
  condicao: CondicaoParaAvaliar | null;
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

/**
 * RN-PED-07: o pedido só usa prazo completo (RN-CAD-15) e permitido ao cliente (RN-CAD-16). A regra do limite é a do cadastros
 * (`prazoPermitidoAoCliente`, com a exceção do cartão 03 completo); aqui só se diz qual das duas falhou. Sem condição, nulo.
 */
export function avaliarPrazo(
  condicao: CondicaoParaAvaliar | null,
  cliente: { prazo_medio_dias?: number | null },
): 'prazo_incompleto' | 'prazo_acima_do_cliente' | null {
  if (condicao === null) return null;
  if (!prazoCompleto(condicao)) return 'prazo_incompleto';
  return prazoPermitidoAoCliente(condicao, cliente) ? null : 'prazo_acima_do_cliente';
}

/** Texto único do prazo (RN-PED-07): rótulo da pendência na tela e mensagem do 422 do pedido manual. */
export const TEXTO_PRAZO: Readonly<Record<'prazo_incompleto' | 'prazo_acima_do_cliente', string>> = {
  prazo_incompleto: 'Prazo de pagamento incompleto',
  prazo_acima_do_cliente: 'Prazo médio acima do limite do cliente',
};

/** Status cujos pedidos comprometem estoque e crédito (RN-PED-04, P5): aprovado e ainda não faturado por inteiro. */
export const STATUS_COMPROMETEM = ['aprovado', 'faturado_parcial'] as const;

/**
 * RN-PED-04: pedido fora do crédito do cliente (não passa pela análise de crédito nem entra no compromisso).
 * Decisões do Alexandre de 22/11, 01h10 e 01h12: o cartão de crédito (tPag 03) fica fora do crédito, igual ao à vista
 * (01, 17 e débito 04). Só a forma de pagamento decide (`classeForma`, contrato do cadastros). Sem condição, false.
 */
export function foraDoCredito(condicao: Pick<CondicaoPagamento, 'forma_tpag'> | null): boolean {
  if (condicao === null) return false;
  const classe = classeForma(condicao.forma_tpag);
  return classe === 'a_vista' || classe === 'cartao';
}

/** RN-PED-04; decisões de 22/11, 01h10 e 01h12: fora do crédito (`foraDoCredito`) não há pendência de crédito. */
export function avaliarCredito(a: {
  condicao: Pick<CondicaoPagamento, 'forma_tpag'> | null;
  limite_credito_centavos: number;
  titulos_abertos_centavos: number;
  compromisso_credito_centavos: number;
  total_centavos: number;
}): { codigo: 'credito_sem_limite' | 'credito_excedido'; esperado: number; informado: number } | null {
  if (foraDoCredito(a.condicao)) return null;
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
  // RN-PED-07: bloqueante; o analista troca o prazo.
  const prazo = avaliarPrazo(e.condicao, e.cliente);
  if (prazo === 'prazo_incompleto') r.push(pend('prazo_incompleto', true));
  else if (prazo === 'prazo_acima_do_cliente') r.push(pend('prazo_acima_do_cliente', true, null, null, e.cliente.prazo_medio_dias ?? null, e.condicao?.prazo_medio_dias ?? null));

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
  /** `unidade_comercial` do cadastro: a unidade da quantidade (RN-CAD-17). */
  produtos: readonly { id: string; inativo: boolean; unidade_comercial: string }[];
  itens: readonly (ItemValor & { produto_id: string })[];
}

/** `motivo` (opcional) é o texto do problema quando o código sozinho não diz (`item_incoerente` por fração, RN-CAD-17). */
export type DecisaoRecebimentoFdv = { resultado: 'aprovado' } | { resultado: 'recusado'; codigo: CodigoRecusaCadastro; motivo?: string };

/**
 * RN-PED-07 (emenda de 24/11): o pedido do FDV com prazo incompleto ou acima do cliente não é recusado; entra em análise com a
 * pendência bloqueante (o analista troca o prazo). Sem problema de prazo, entra aprovado.
 */
export function decidirPrazoRecebimentoFdv(
  condicao: CondicaoParaAvaliar | null,
  cliente: { prazo_medio_dias?: number | null },
): { status: 'aprovado' | 'em_analise'; pendencias: PendenciaDetalhada[] } {
  const falha = avaliarPrazo(condicao, cliente);
  if (falha === null) return { status: 'aprovado', pendencias: [] };
  const informado = falha === 'prazo_acima_do_cliente' ? (condicao?.prazo_medio_dias ?? null) : null;
  const esperado = falha === 'prazo_acima_do_cliente' ? (cliente.prazo_medio_dias ?? null) : null;
  return { status: 'em_analise', pendencias: [pend(falha, true, null, null, esperado, informado)] };
}

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
  // A sequência repetida quebraria a ida e volta do retorno (T-0013 §5.2): é item incoerente.
  if (new Set(r.itens.map((i) => i.sequencia)).size !== r.itens.length) return recusa('item_incoerente');
  // RN-CAD-17 (T-0097): fração fora de KG e M é item incoerente, com o motivo da regra; não entra em análise.
  const fracao = verificarFracaoDosItens(r.itens, (id) => produtos.get(id)?.unidade_comercial);
  if (fracao[0]) return { resultado: 'recusado', codigo: 'item_incoerente', motivo: `RN-CAD-17: ${fracao[0].mensagem}` };
  return { resultado: 'aprovado' };
}
