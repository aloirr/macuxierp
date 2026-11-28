import { CST_IPI_ENTRADA, CST_IPI_SEM_VALOR, CST_IPI_TRIBUTADO, type ImpostoCalculado, type IpiItem, type ItemCalculo, type RegraTributaria } from '../contracts';
import { aplicarPercentual, valorOperacao, valorPorUnidade } from './dinheiro';
import type { CodigoErroCalculo } from './erros';

export type ResultadoIpi = { ok: true; ipi: IpiItem; v_ipi: number } | { ok: false; codigo: CodigoErroCalculo; mensagem: string };

/**
 * RN-FIS-02 (IPI, NF-e de saída): CST 50/99 tributados, ad valorem sobre a BC (valorOperacao) ou por unidade (valor ×10^4 de real);
 * CST 51..55 saem só com CST e enquadramento, sem valor. CST de entrada (00..05, 49) é recusado. Alíquota e valor por unidade
 * ao mesmo tempo é regra ambígua (REGRA_INCOMPLETA).
 */
export function calcularIpiItem(item: ItemCalculo, regra: RegraTributaria): ResultadoIpi {
  const cst = regra.cst_ipi;
  if (cst === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} é de IPI mas não traz cst_ipi.` };
  if ((CST_IPI_ENTRADA as readonly string[]).includes(cst)) {
    return { ok: false, codigo: 'CODIGO_INCOMPATIVEL_REGIME', mensagem: `O CST de IPI ${cst} é de entrada; o motor cobre só NF-e de saída (50..55 e 99).` };
  }
  if (!(CST_IPI_TRIBUTADO as readonly string[]).includes(cst)) {
    if ((CST_IPI_SEM_VALOR as readonly string[]).includes(cst)) return { ok: true, ipi: { cst, c_enq: regra.c_enq }, v_ipi: 0 };
    return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `CST de IPI ${cst} inválido.` };
  }
  if (regra.valor_unidade_ipi !== null && regra.aliquota_ipi !== null) {
    return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (IPI) traz alíquota e valor por unidade ao mesmo tempo: regra ambígua.` };
  }
  if (regra.valor_unidade_ipi !== null) {
    const v = valorPorUnidade(item.quantidade, regra.valor_unidade_ipi);
    return { ok: true, ipi: { cst, c_enq: regra.c_enq, q_unid: item.quantidade, v_unid: regra.valor_unidade_ipi, v_ipi: v }, v_ipi: v };
  }
  if (regra.aliquota_ipi === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (CST de IPI ${cst}) exige alíquota ou valor por unidade.` };
  const bc = valorOperacao(item);
  if (bc < 0) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor do item: base de cálculo do IPI negativa.' };
  const v = aplicarPercentual(bc, regra.aliquota_ipi);
  return { ok: true, ipi: { cst, c_enq: regra.c_enq, v_bc: bc, p_ipi: regra.aliquota_ipi, v_ipi: v }, v_ipi: v };
}

/**
 * RN-FIS-05 (63 A): IPI calculado por regra. Há regra sempre que o motor montou o grupo IPI a partir de uma regra de IPI (inclusive CST 51..55, valor 0).
 * Alíquota nunca é inventada: ad valorem usa a da regra; por unidade (pauta) e CST sem valor não têm alíquota ad valorem e saem com v_bc e p_aliq 0.
 */
export function calcIpiDoGrupo(ipi: IpiItem | undefined): ImpostoCalculado | undefined {
  if (!ipi) return undefined;
  return { v_bc: ipi.v_bc ?? 0, p_aliq: ipi.p_ipi ?? 0, v_valor: ipi.v_ipi ?? 0 };
}
