/**
 * Montagem da nota a partir do pedido aprovado (RF-FAT-01), total ou parcial. Funções puras; dinheiro em centavos
 * (RN-CORE-03), quantidade em escala 4. A API revalida com a situação lida com `FOR SHARE` na transação que reserva o número.
 */
import { centavos, ratear, type Centavos } from '@macuxierp/platform-sdk';
import type { Ambiente, ItemEmissao } from '../contracts';
import { violacao, type Violacao } from './violacao';

export const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
const ESCALA_QTD = 10_000n;

// DUBLÊ até T-0015: o `PedidoAprovado` real vem de `@macuxierp/pedido/contracts` (T-0013 §8.1).
export interface ItemPedidoAprovado {
  sequencia: number;
  produto_id: string;
  produto_retrato: { codigo: string; descricao: string; ncm: string; unidade: string; gtin: string | null };
  quantidade: number;
  preco_unitario_centavos: number;
  desconto_centavos: number;
  total_centavos: number;
}
// DUBLÊ até T-0015.
export interface PedidoAprovadoMin {
  pedido_id: string;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  condicao_pagamento_id: string | null;
  emitido_em: string;
  observacao: string | null;
  frete_centavos: number;
  itens: ItemPedidoAprovado[];
  total_centavos: number;
}
// DUBLÊ até T-0015: porta `SituacaoPedidoParaFaturar` (T-0013 §8.1).
export interface SituacaoPedido {
  status: string;
  itens: { sequencia: number; quantidade: number; quantidade_faturada: number }[];
}

// DUBLÊ até T-0020 (`fiscal.calculo@1`). Estrutura mínima; IBS/CBS/IS da NT 2025.002-RTC entram quando o cálculo os trouxer.
export interface CalculoFiscalItem {
  sequencia: number;
  cfop: string;
  icms: {
    orig: number;
    cst?: string;
    csosn?: string;
    vbc_centavos: number;
    aliquota_pct: number;
    valor_centavos: number;
    /** Só CSOSN 101 (crédito do Simples). */
    pcredsn_pct?: number;
    vcredicmssn_centavos?: number;
  };
  ipi_centavos: number;
  /** Grupo IPI do item; obrigatório quando `ipi_centavos > 0`. */
  ipi?: { cst: string; cenq: string; vbc_centavos: number; aliquota_pct: number };
  st_centavos: number;
  pis_centavos: number;
  cofins_centavos: number;
  /** Base, alíquota e CST do PIS/COFINS; obrigatórios quando o valor é maior que zero. */
  pis?: { cst: string; vbc_centavos: number; aliquota_pct: number };
  cofins?: { cst: string; vbc_centavos: number; aliquota_pct: number };
  ibs_cbs: null | { cst: string; cclasstrib: string; vbc_centavos: number; ibs_centavos: number; cbs_centavos: number };
  imposto_seletivo: null | { cst: string; cclasstrib: string; vbc_centavos: number; valor_centavos: number };
}

/** Mesmo item de `EmitirNotaEntrada` (contracts); `quantidade` em escala 4, omitida = todo o saldo do item. */
export type SolicitacaoItem = ItemEmissao;

export interface NotaItemMontado {
  sequencia: number;
  produto_id: string;
  /** Código do produto no retrato do pedido (vira `cProd`). */
  codigo: string;
  descricao: string;
  ncm: string;
  unidade: string;
  gtin: string | null;
  quantidade: number;
  preco_unitario_centavos: number;
  valor_produto_centavos: number;
  desconto_centavos: number;
  frete_centavos: number;
  outras_centavos: number;
  calculo: CalculoFiscalItem;
}

export interface TotaisNota {
  vProd: number;
  vDesc: number;
  vFrete: number;
  vOutro: number;
  vBC: number;
  vICMS: number;
  vIPI: number;
  vST: number;
  vPIS: number;
  vCOFINS: number;
  vIBS: number;
  vCBS: number;
  vIS: number;
  vNF: number;
}

export interface NotaMontada {
  pedido_id: string;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  ambiente: Ambiente;
  /** RN-FAT-04: nota de homologação nunca vai ao FDV como faturamento. */
  vai_ao_fdv: boolean;
  itens: NotaItemMontado[];
  totais: TotaisNota;
}

/** Local até o platform-sdk exportar (RD-0273 a RD-0276). Divide `numerador × valor / denominador` meio para cima, em inteiros exatos. */
function divArred(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('divisão por zero');
  const q = num / den;
  const r = num % den;
  return r * 2n >= den ? q + 1n : q;
}

/** vProd = arred(qtd4 × preço / 10^4) (Manual da NF-e). Local até o platform-sdk exportar (RD-0273 a RD-0276). */
export function valorItem(qtd4: number, precoCentavos: number): Centavos {
  return centavos(Number(divArred(BigInt(qtd4) * BigInt(precoCentavos), ESCALA_QTD)));
}

/** Local até o platform-sdk exportar (RD-0273 a RD-0276). Rateio proporcional aos pesos sem perder centavo (RN-CORE-03): a diferença vai para o primeiro item, como o `ratear` do SDK. */
export function ratearProporcional(total: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return [];
  const soma = pesos.reduce((a, p) => a + p, 0);
  if (soma === 0) return ratear(centavos(total), pesos.length);
  const partes = pesos.map((p) => Number((BigInt(total) * BigInt(p)) / BigInt(soma)));
  partes[0] = (partes[0] ?? 0) + total - partes.reduce((a, p) => a + p, 0);
  return partes;
}

/** RN-FAT-04: em homologação o xNome do destinatário é o texto do Manual. */
export function xNomeDestinatario(ambiente: Ambiente, nome: string): string {
  return ambiente === 'homologacao' ? XNOME_HOMOLOGACAO : nome;
}

export const nfeVaiAoFdv = (ambiente: Ambiente): boolean => ambiente === 'producao';

export interface EntradaMontagem {
  pedido: PedidoAprovadoMin;
  situacao: SituacaoPedido;
  /** Sem lista = nota total do saldo. */
  itens?: SolicitacaoItem[];
  ambiente: Ambiente;
  calculo: CalculoFiscalItem[];
  outras_centavos?: number;
}

export type ResultadoMontagem = { ok: true; nota: NotaMontada } | { ok: false; violacoes: Violacao[] };

export function montarNota(e: EntradaMontagem): ResultadoMontagem {
  const v: Violacao[] = [];
  if (e.situacao.status !== 'aprovado' && e.situacao.status !== 'faturado_parcial') {
    return { ok: false, violacoes: [violacao('RN-PED-02', 'status', `Pedido em "${e.situacao.status}" não pode ser faturado.`)] };
  }
  const saldoDe = new Map(e.situacao.itens.map((i) => [i.sequencia, i.quantidade - i.quantidade_faturada]));
  const pedidoDe = new Map(e.pedido.itens.map((i) => [i.sequencia, i]));
  const solicitados: SolicitacaoItem[] =
    e.itens ?? [...saldoDe.entries()].filter(([, s]) => s > 0).map(([sequencia]) => ({ sequencia }));
  if (solicitados.length === 0) v.push(violacao('RF-FAT-01', 'itens', 'Pedido sem saldo a faturar.'));

  const vistos = new Set<number>();
  const escolhidos: { item: ItemPedidoAprovado; quantidade: number }[] = [];
  for (const s of solicitados) {
    const item = pedidoDe.get(s.sequencia);
    const saldo = saldoDe.get(s.sequencia);
    if (!item || saldo === undefined) {
      v.push(violacao('RF-FAT-01', `itens.${s.sequencia}`, `Item ${s.sequencia} não existe no pedido.`));
      continue;
    }
    if (vistos.has(s.sequencia)) {
      v.push(violacao('RF-FAT-01', `itens.${s.sequencia}`, `Item ${s.sequencia} repetido.`));
      continue;
    }
    vistos.add(s.sequencia);
    const quantidade = s.quantidade ?? saldo;
    if (!Number.isInteger(quantidade) || quantidade < 1) v.push(violacao('RF-FAT-01', `itens.${s.sequencia}.quantidade`, 'Quantidade deve ser positiva (escala 4).'));
    else if (quantidade > saldo) v.push(violacao('RF-FAT-01', `itens.${s.sequencia}.quantidade`, `Quantidade acima do saldo (${saldo}).`));
    else escolhidos.push({ item, quantidade });
  }
  const calcDe = new Map(e.calculo.map((c) => [c.sequencia, c]));
  for (const { item } of escolhidos) {
    if (!calcDe.has(item.sequencia)) v.push(violacao('RF-FAT-01', `itens.${item.sequencia}.calculo`, `Sem cálculo fiscal para o item ${item.sequencia}.`));
  }
  if (v.length > 0) return { ok: false, violacoes: v };

  const brutos: number[] = escolhidos.map(({ item, quantidade }) => valorItem(quantidade, item.preco_unitario_centavos));
  // Pelo acumulado (RN-CORE-03): arred(v × (faturada + q) / qtd) − arred(v × faturada / qtd). A soma das notas parciais bate com o pedido.
  const faturadaDe = new Map(e.situacao.itens.map((i) => [i.sequencia, i.quantidade_faturada]));
  const descontos: number[] = escolhidos.map(({ item, quantidade }) => {
    const antes = faturadaDe.get(item.sequencia) ?? 0;
    const acumulado = (q: number): bigint => divArred(BigInt(item.desconto_centavos) * BigInt(q), BigInt(item.quantidade));
    return Number(acumulado(antes + quantidade) - acumulado(antes));
  });
  descontos.forEach((d, i) => {
    const bruto = brutos[i] ?? 0;
    const seq = escolhidos[i]?.item.sequencia ?? 0;
    if (d > bruto) v.push(violacao('RF-FAT-01', `itens.${seq}.desconto`, 'Desconto acima do valor do item.'));
  });
  if (v.length > 0) return { ok: false, violacoes: v };

  // Frete do pedido pelo acumulado do valor bruto faturado (RN-CORE-03): arred(F × depois / bruto) − arred(F × antes / bruto).
  const brutoPedido = e.pedido.itens.reduce((a, i) => a + valorItem(i.quantidade, i.preco_unitario_centavos), 0);
  const brutoAntes = e.pedido.itens.reduce((a, i) => a + valorItem(faturadaDe.get(i.sequencia) ?? 0, i.preco_unitario_centavos), 0);
  const brutoDepois = escolhidos.reduce(
    (a, { item, quantidade }) => {
      const antes = faturadaDe.get(item.sequencia) ?? 0;
      return a + valorItem(antes + quantidade, item.preco_unitario_centavos) - valorItem(antes, item.preco_unitario_centavos);
    },
    brutoAntes,
  );
  const freteAcum = (b: number): bigint => divArred(BigInt(e.pedido.frete_centavos) * BigInt(b), BigInt(brutoPedido));
  const freteNota = brutoPedido === 0 ? 0 : Number(freteAcum(brutoDepois) - freteAcum(brutoAntes));
  const fretes = ratearProporcional(freteNota, brutos);
  const outras = ratearProporcional(e.outras_centavos ?? 0, brutos);

  const itens: NotaItemMontado[] = escolhidos.map(({ item, quantidade }, i) => ({
    sequencia: item.sequencia,
    produto_id: item.produto_id,
    codigo: item.produto_retrato.codigo,
    descricao: item.produto_retrato.descricao,
    ncm: item.produto_retrato.ncm,
    unidade: item.produto_retrato.unidade,
    gtin: item.produto_retrato.gtin,
    quantidade,
    preco_unitario_centavos: item.preco_unitario_centavos,
    valor_produto_centavos: brutos[i] ?? 0,
    desconto_centavos: descontos[i] ?? 0,
    frete_centavos: fretes[i] ?? 0,
    outras_centavos: outras[i] ?? 0,
    calculo: calcDe.get(item.sequencia) as CalculoFiscalItem,
  }));
  const soma = (f: (i: NotaItemMontado) => number): number => itens.reduce((a, i) => a + f(i), 0);
  const totais: TotaisNota = {
    vProd: soma((i) => i.valor_produto_centavos),
    vDesc: soma((i) => i.desconto_centavos),
    vFrete: soma((i) => i.frete_centavos),
    vOutro: soma((i) => i.outras_centavos),
    vBC: soma((i) => i.calculo.icms.vbc_centavos),
    vICMS: soma((i) => i.calculo.icms.valor_centavos),
    vIPI: soma((i) => i.calculo.ipi_centavos),
    vST: soma((i) => i.calculo.st_centavos),
    vPIS: soma((i) => i.calculo.pis_centavos),
    vCOFINS: soma((i) => i.calculo.cofins_centavos),
    vIBS: soma((i) => i.calculo.ibs_cbs?.ibs_centavos ?? 0),
    vCBS: soma((i) => i.calculo.ibs_cbs?.cbs_centavos ?? 0),
    vIS: soma((i) => i.calculo.imposto_seletivo?.valor_centavos ?? 0),
    vNF: 0,
  };
  // IBS/CBS/IS não entram no vNF de 2026 (informativos na transição; confirmar na T-0020).
  totais.vNF = totais.vProd - totais.vDesc + totais.vFrete + totais.vOutro + totais.vIPI + totais.vST;
  return {
    ok: true,
    nota: {
      pedido_id: e.pedido.pedido_id,
      filial_id: e.pedido.filial_id,
      cliente_id: e.pedido.cliente_id,
      vendedor_id: e.pedido.vendedor_id,
      ambiente: e.ambiente,
      vai_ao_fdv: nfeVaiAoFdv(e.ambiente),
      itens,
      totais,
    },
  };
}
