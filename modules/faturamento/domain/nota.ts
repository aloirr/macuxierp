/**
 * Montagem da nota a partir do pedido aprovado (RF-FAT-01), total ou parcial. Funções puras; dinheiro em centavos
 * (RN-CORE-03), quantidade em escala 4. A API revalida com a situação lida com `FOR SHARE` na transação que reserva o número.
 */
import { centavos, ratear, valorItem } from '@macuxierp/platform-sdk';
import type { ItemResultado } from '@macuxierp/fiscal/contracts';
import type { PedidoAprovadoV1, SituacaoPedidoParaFaturar } from '@macuxierp/pedido/contracts';
import type { Ambiente, ItemEmissao } from '../contracts';
import { violacao, type Violacao } from './violacao';

/** Pedido aprovado como o evento `pedido.pedido.aprovado@1` o entrega (contrato real, T-0013 §8.1): identificação + `pedido` inteiro. */
export type PedidoFaturavel = PedidoAprovadoV1;
export type ItemPedidoAprovado = PedidoFaturavel['pedido']['itens'][number];

/** Contrato real da porta do pedido (`criarConsultaParaFaturar` do `pedido/api`): status e saldo por item, lidos com `FOR SHARE`. */
export type SituacaoPedido = SituacaoPedidoParaFaturar;

/**
 * Resultado fiscal de um item (`fiscal.calculo@1`, `ItemResultado`) + o CFOP. O contrato do cálculo recebe o CFOP na
 * entrada e não o devolve: quem chama o motor o informa aqui (pendência: de onde vem o CFOP, ver README).
 */
export interface ItemCalculado {
  sequencia: number;
  cfop: string;
  resultado: ItemResultado;
}

/** CST de PIS/COFINS cujo grupo do XML traz o valor (Aliq 01/02 e Outr 49 a 99); NT (04 a 09) e Qtde (03) não somam aqui. */
export const pisCofinsComValor = (cst: string | undefined): boolean => cst === '01' || cst === '02' || (cst !== undefined && /^(49|[5-9]\d)$/.test(cst));

const ICMS_COM_VALOR = new Set(['00', '10', '20']);
const ICMS_COM_ST = new Set(['10', '201', '202', '203']);

/**
 * Valores do item no formato do XML, lidos do `ItemResultado` (ausente = 0). Soma só o que o XML emite em cada CST/CSOSN
 * (RN-FAT-01): CST 40/41/50 e CSOSN 101/102/103/300/400 não emitem vBC/vICMS; vST e FCP-ST só em CST 10 e CSOSN 201/202/203.
 * IBS/CBS/IS do lote 3 do fiscal (`ibs_cbs`: vIBS e `g_cbs.v_cbs`; `is.v_is`); os grupos `ibs` e `cbs` do @1 são obsoletos e só servem de reserva.
 */
export function valoresFiscais(r: ItemResultado): {
  vBC: number; vICMS: number; vBCST: number; vST: number; vFCP: number; vFCPST: number; vIPI: number; vPIS: number; vCOFINS: number; vIBS: number; vCBS: number; vIS: number;
} {
  const cod = r.icms.csosn ?? r.icms.cst ?? '';
  const comValor = !r.icms.csosn && ICMS_COM_VALOR.has(cod);
  const comSt = ICMS_COM_ST.has(cod);
  return {
    vBC: comValor ? (r.icms.v_bc ?? 0) : 0,
    vICMS: comValor ? (r.icms.v_icms ?? 0) : 0,
    vBCST: comSt ? (r.icms.v_bc_st ?? 0) : 0,
    vST: comSt ? (r.icms.v_icms_st ?? 0) : 0,
    vFCP: comValor ? (r.icms.v_fcp ?? 0) : 0,
    vFCPST: comSt ? (r.icms.v_fcp_st ?? 0) : 0,
    vIPI: r.ipi?.v_ipi ?? 0,
    vPIS: pisCofinsComValor(r.pis?.cst) ? (r.pis?.v_valor ?? 0) : 0,
    vCOFINS: pisCofinsComValor(r.cofins?.cst) ? (r.cofins?.v_valor ?? 0) : 0,
    vIBS: r.ibs_cbs?.v_ibs ?? (r.ibs?.v_ibs_uf ?? 0) + (r.ibs?.v_ibs_mun ?? 0),
    vCBS: r.ibs_cbs?.g_cbs?.v_cbs ?? r.cbs?.v_cbs ?? r.ibs?.v_cbs ?? 0,
    vIS: r.is?.v_is ?? 0,
  };
}

/** CFOP do item: o do `ItemResultado.cfop` do fiscal (lote 3); sem ele, o que a porta do cálculo devolveu à parte. */
export const cfopDoItem = (r: ItemResultado, doMapa: string | undefined): string => r.cfop ?? doMapa ?? '';

/** Resumo do item nos eventos e na consulta da nota: quantidade e valor líquido (produto − desconto). */
export const resumoDoItem = (i: Pick<NotaItemBase, 'sequencia' | 'quantidade' | 'valor_produto_centavos' | 'desconto_centavos'>): { sequencia: number; quantidade: number; valor_centavos: number } => ({
  sequencia: i.sequencia,
  quantidade: i.quantidade,
  valor_centavos: i.valor_produto_centavos - i.desconto_centavos,
});

/** Mesmo item de `EmitirNotaEntrada` (contracts); `quantidade` em escala 4, omitida = todo o saldo do item. */
export type SolicitacaoItem = ItemEmissao;

/** Item já com valores e rateios, antes do cálculo fiscal (o cálculo precisa de valor, desconto e frete do item). */
export interface NotaItemBase {
  sequencia: number;
  produto_id: string;
  /** Código do produto no retrato do pedido (vira `cProd`). */
  codigo: string;
  descricao: string;
  ncm: string;
  unidade: string;
  gtin: string | null;
  /** Origem da mercadoria (`ProdutoRetrato.origem`): vira o `orig` do ICMS no XML. */
  origem: string;
  quantidade: number;
  preco_unitario_centavos: number;
  valor_produto_centavos: number;
  desconto_centavos: number;
  frete_centavos: number;
  outras_centavos: number;
}
export interface NotaItemMontado extends NotaItemBase {
  calculo: ItemCalculado;
}

export interface TotaisNota {
  vProd: number;
  vDesc: number;
  vFrete: number;
  vOutro: number;
  vBC: number;
  vICMS: number;
  vBCST: number;
  vST: number;
  vFCP: number;
  vFCPST: number;
  vIPI: number;
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

/** Divide `num / den` meio para cima, em inteiros exatos (não negativos). Local até o sdk exportar (RD-0367/0368). */
function divArred(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('divisão por zero');
  const q = num / den;
  const r = num % den;
  return r * 2n >= den ? q + 1n : q;
}

/** Rateio proporcional aos pesos sem perder centavo (RN-CORE-03): a diferença vai para o primeiro item, como o `ratear` do SDK. */
export function ratearProporcional(total: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return [];
  const soma = pesos.reduce((a, p) => a + p, 0);
  if (soma === 0) return ratear(centavos(total), pesos.length);
  const partes = pesos.map((p) => Number((BigInt(total) * BigInt(p)) / BigInt(soma)));
  partes[0] = (partes[0] ?? 0) + total - partes.reduce((a, p) => a + p, 0);
  return partes;
}

/** RN-FAT-04: só produção vai ao FDV (único lugar que decide). */
export const nfeVaiAoFdv = (ambiente: Ambiente): boolean => ambiente === 'producao';

export interface EntradaItens {
  pedido: PedidoFaturavel;
  situacao: SituacaoPedido;
  /** Sem lista = nota total do saldo. */
  itens?: SolicitacaoItem[];
  /** Frete em centavos; omitido = `Frete.valor_centavos` do pedido (nulo vale 0). */
  frete_centavos?: number;
  outras_centavos?: number;
}
export interface EntradaMontagem extends EntradaItens {
  ambiente: Ambiente;
  calculo: ItemCalculado[];
  /** `totais.v_nf` do `fiscal.calculo@1`: o vNF da nota é conferido com ele (RD-0283); divergência é violação. */
  v_nf_fiscal?: number;
}

export type ResultadoItens = { ok: true; itens: NotaItemBase[] } | { ok: false; violacoes: Violacao[] };
export type ResultadoMontagem = { ok: true; nota: NotaMontada } | { ok: false; violacoes: Violacao[] };

/** Passo 1 da nota: confere situação e saldo, e calcula valor, desconto, frete e outras por item (sem o cálculo fiscal). */
export function ratearItens(e: EntradaItens): ResultadoItens {
  const v: Violacao[] = [];
  if (e.situacao.status !== 'aprovado' && e.situacao.status !== 'faturado_parcial') {
    return { ok: false, violacoes: [violacao('RN-PED-02', 'status', `Pedido em "${e.situacao.status}" não pode ser faturado.`)] };
  }
  const itensPedido = e.pedido.pedido.itens;
  const saldoDe = new Map(e.situacao.itens.map((i) => [i.sequencia, i.quantidade - i.quantidade_faturada]));
  const pedidoDe = new Map(itensPedido.map((i) => [i.sequencia, i]));
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
  const frete = e.frete_centavos ?? e.pedido.pedido.frete?.valor_centavos ?? 0;
  const brutoPedido = itensPedido.reduce((a, i) => a + valorItem(i.quantidade, i.preco_unitario_centavos), 0);
  const brutoAntes = itensPedido.reduce((a, i) => a + valorItem(faturadaDe.get(i.sequencia) ?? 0, i.preco_unitario_centavos), 0);
  const brutoDepois = escolhidos.reduce(
    (a, { item, quantidade }) => {
      const antes = faturadaDe.get(item.sequencia) ?? 0;
      return a + valorItem(antes + quantidade, item.preco_unitario_centavos) - valorItem(antes, item.preco_unitario_centavos);
    },
    brutoAntes,
  );
  const freteAcum = (b: number): bigint => divArred(BigInt(frete) * BigInt(b), BigInt(brutoPedido));
  const freteNota = brutoPedido === 0 ? 0 : Number(freteAcum(brutoDepois) - freteAcum(brutoAntes));
  const fretes = ratearProporcional(freteNota, brutos);
  const outras = ratearProporcional(e.outras_centavos ?? 0, brutos);

  return {
    ok: true,
    itens: escolhidos.map(({ item, quantidade }, i) => ({
      sequencia: item.sequencia,
      produto_id: item.produto_id,
      codigo: item.produto_retrato.codigo,
      descricao: item.produto_retrato.descricao,
      ncm: item.produto_retrato.ncm,
      unidade: item.produto_retrato.unidade_comercial,
      gtin: item.produto_retrato.ean,
      origem: item.produto_retrato.origem,
      quantidade,
      preco_unitario_centavos: item.preco_unitario_centavos,
      valor_produto_centavos: brutos[i] ?? 0,
      desconto_centavos: descontos[i] ?? 0,
      frete_centavos: fretes[i] ?? 0,
      outras_centavos: outras[i] ?? 0,
    })),
  };
}

/**
 * Totais da nota pela soma dos itens. vNF = vProd − vDesc + vFrete + vOutro + vIPI + vST + vFCPST (IBS/CBS/IS não entram em
 * 2026). É a única conta de vNF; a referência é o `totais.v_nf` do fiscal (RD-0283). Também refaz os totais de uma nota gravada.
 */
export function calcularTotais(itens: readonly NotaItemMontado[]): TotaisNota {
  const soma = (f: (i: NotaItemMontado) => number): number => itens.reduce((a, i) => a + f(i), 0);
  const val = (i: NotaItemMontado): ReturnType<typeof valoresFiscais> => valoresFiscais(i.calculo.resultado);
  const totais: TotaisNota = {
    vProd: soma((i) => i.valor_produto_centavos),
    vDesc: soma((i) => i.desconto_centavos),
    vFrete: soma((i) => i.frete_centavos),
    vOutro: soma((i) => i.outras_centavos),
    vBC: soma((i) => val(i).vBC),
    vICMS: soma((i) => val(i).vICMS),
    vBCST: soma((i) => val(i).vBCST),
    vST: soma((i) => val(i).vST),
    vFCP: soma((i) => val(i).vFCP),
    vFCPST: soma((i) => val(i).vFCPST),
    vIPI: soma((i) => val(i).vIPI),
    vPIS: soma((i) => val(i).vPIS),
    vCOFINS: soma((i) => val(i).vCOFINS),
    vIBS: soma((i) => val(i).vIBS),
    vCBS: soma((i) => val(i).vCBS),
    vIS: soma((i) => val(i).vIS),
    vNF: 0,
  };
  totais.vNF = totais.vProd - totais.vDesc + totais.vFrete + totais.vOutro + totais.vIPI + totais.vST + totais.vFCPST;
  return totais;
}

/** Passo 2: junta o cálculo fiscal aos itens e fecha os totais. */
export function montarNota(e: EntradaMontagem): ResultadoMontagem {
  const base = ratearItens(e);
  if (!base.ok) return base;
  const calcDe = new Map(e.calculo.map((c) => [c.sequencia, c]));
  const faltando = base.itens.filter((i) => !calcDe.has(i.sequencia));
  if (faltando.length > 0) {
    return { ok: false, violacoes: faltando.map((i) => violacao('RF-FAT-01', `itens.${i.sequencia}.calculo`, `Sem cálculo fiscal para o item ${i.sequencia}.`)) };
  }
  const itens: NotaItemMontado[] = base.itens.map((i) => ({ ...i, calculo: calcDe.get(i.sequencia) as ItemCalculado }));
  const totais = calcularTotais(itens);
  if (e.v_nf_fiscal !== undefined && e.v_nf_fiscal !== totais.vNF) {
    return { ok: false, violacoes: [violacao('RF-FAT-01', 'total', `vNF da nota (${totais.vNF}) difere do v_nf do cálculo fiscal (${e.v_nf_fiscal}).`)] };
  }
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
