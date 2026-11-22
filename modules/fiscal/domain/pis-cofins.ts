import type { Crt, ItemCalculo, PisCofinsItem, RegraTributaria } from '../contracts';
import { aplicarPercentual, valorOperacao, valorPorUnidade } from './dinheiro';
import type { CodigoErroCalculo } from './erros';
import { camposDoTributo, pisCofinsNoDas } from './regra';

export type TributoPisCofins = 'pis' | 'cofins';
export type RegimePisCofins = 'cumulativo' | 'nao_cumulativo';

/** CST padrão do Simples (CRT 1, 2 e 4) sem regra cadastrada: 99, sem valor (PIS/COFINS recolhidos no DAS). */
export const CST_SIMPLES_PADRAO = '99';
/** NF-e de saída: 01..09, 49 e 99. Os CST de entrada (50..66, 70..75, 98) são recusados. */
const CST_SAIDA = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49', '99'];
const CST_ENTRADA = [...Array.from({ length: 17 }, (_, i) => String(50 + i)), '70', '71', '72', '73', '74', '75', '98'];
const CST_ADVALOREM = ['01', '02'];
const CST_UNIDADE = ['03'];
const CST_SEM_VALOR = ['04', '05', '06', '07', '08', '09'];
/** CST aceitos no Simples (sempre sem valor). */
const CST_SIMPLES = [...CST_SEM_VALOR, '49', '99'];

/**
 * BC de PIS/COFINS = valorOperacao (as despesas acessórias cobradas do adquirente compõem o faturamento; o IPI e o ICMS-ST não entram).
 * Com `excluir_icms_bc` (tema 69 do STF, padrão false) subtrai o vICMS destacado do item. Nunca negativa na exclusão (mínimo 0);
 * a base negativa por desconto é erro do chamador.
 */
export function basePisCofins(item: ItemCalculo, excluirIcms: boolean, vIcms: number): number {
  const base = valorOperacao(item);
  return excluirIcms ? Math.max(0, base - vIcms) : base;
}

export interface ContextoPisCofins {
  tributo: TributoPisCofins;
  item: ItemCalculo;
  /** Regra aplicável ou null (só o DAS, CRT 1/2/4, dispensa a regra). */
  regra: RegraTributaria | null;
  crt: Crt;
  /** Obrigatório no CRT 3: a falta dele é erro tipado (REGRA_INCOMPLETA). */
  regime?: RegimePisCofins | undefined;
  /** vICMS destacado do item (para a exclusão do tema 69). */
  v_icms: number;
}
export type ResultadoPisCofins = { ok: true; grupo: PisCofinsItem; v_valor: number } | { ok: false; codigo: CodigoErroCalculo; mensagem: string };

/**
 * RN-FIS-02 (PIS/COFINS, NF-e de saída): CST 01/02 ad valorem sobre a BC; 03 valor por unidade (pauta, ×10^4 de real); 04..09 sem valor;
 * 49 e 99 calculam se a regra trouxer alíquota (ou valor por unidade), senão saem só com o CST. CST de entrada é recusado
 * (CODIGO_INCOMPATIVEL_REGIME). Alíquota e valor por unidade ao mesmo tempo é regra ambígua (REGRA_INCOMPLETA). No DAS (CRT 1/2/4)
 * só valem 04..09, 49 e 99, sempre sem valor. Alíquotas (cumulativo 0,65%/3%, não cumulativo 1,65%/7,6%) vêm da regra;
 * o regime é exigido no CRT 3.
 */
export function calcularPisCofinsItem(c: ContextoPisCofins): ResultadoPisCofins {
  const rot = c.tributo.toUpperCase();
  const das = pisCofinsNoDas(c.crt);
  if (c.regra === null) {
    if (das) return { ok: true, grupo: { cst: CST_SIMPLES_PADRAO }, v_valor: 0 };
    return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `Falta a regra de ${rot} para o regime normal.` };
  }
  const r = c.regra;
  const { cst, aliquota: aliq, valor_unidade: unid } = camposDoTributo(r, c.tributo);
  if (cst === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} é de ${rot} mas não traz o CST.` };
  if (CST_ENTRADA.includes(cst)) {
    return { ok: false, codigo: 'CODIGO_INCOMPATIVEL_REGIME', mensagem: `O CST ${cst} de ${rot} é de entrada; o motor cobre só NF-e de saída (01..09, 49 e 99).` };
  }
  if (!CST_SAIDA.includes(cst)) return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `CST de ${rot} ${cst} inválido.` };
  if (das) {
    if (!CST_SIMPLES.includes(cst)) return { ok: false, codigo: 'CODIGO_INCOMPATIVEL_CRT', mensagem: `No Simples o CST de ${rot} é 04..09, 49 ou 99; a regra traz ${cst}.` };
    return { ok: true, grupo: { cst }, v_valor: 0 };
  }
  if (c.regime === undefined) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `O CRT 3 exige o regime de PIS/COFINS (cumulativo ou não cumulativo) do emitente.` };
  if (CST_SEM_VALOR.includes(cst)) return { ok: true, grupo: { cst }, v_valor: 0 };
  if (aliq !== null && unid !== null) {
    return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (${rot}) traz alíquota e valor por unidade ao mesmo tempo: regra ambígua.` };
  }

  const comUnidade = (u: number): ResultadoPisCofins => {
    const v = valorPorUnidade(c.item.quantidade, u);
    return { ok: true, grupo: { cst, q_bc_prod: c.item.quantidade, v_aliq_prod: u, v_valor: v }, v_valor: v };
  };
  const comAliquota = (a: number): ResultadoPisCofins => {
    const bc = basePisCofins(c.item, r.excluir_icms_bc, c.v_icms);
    if (valorOperacao(c.item) < 0) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: `O desconto é maior que o valor do item: base de ${rot} negativa.` };
    const v = aplicarPercentual(bc, a);
    return { ok: true, grupo: { cst, v_bc: bc, p_aliq: a, v_valor: v }, v_valor: v };
  };
  if (CST_ADVALOREM.includes(cst)) {
    if (aliq === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (CST ${cst} de ${rot}) exige alíquota.` };
    return comAliquota(aliq);
  }
  if (CST_UNIDADE.includes(cst)) {
    if (unid === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (CST 03 de ${rot}) exige valor por unidade.` };
    return comUnidade(unid);
  }
  // 49 e 99
  if (unid !== null) return comUnidade(unid);
  if (aliq !== null) return comAliquota(aliq);
  return { ok: true, grupo: { cst }, v_valor: 0 };
}
