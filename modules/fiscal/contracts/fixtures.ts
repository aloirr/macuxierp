/** Fixtures do contrato fiscal.calculo@1 para ST e IPI por regra (RN-FIS-05, decisão 63 A). Usadas por pedido, faturamento e integracao-fdv. */
import type { CalculoSaida } from './index';

const regra = { id: '00000000-0000-4000-8000-000000000001', fonte: { tipo: 'convenio', referencia: 'Convênio ICMS 142/2018' }, versao: '1' };
const totaisBase = { v_bc: 10000, v_icms: 1800, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 10000, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: 10000, v_cred_icms_sn: 0 };
const item = (id: string, extra: object = {}) => ({ item_id: id, icms: { orig: '0' }, regra, ...extra });

/** Dois itens com regra de ST e de IPI; o segundo tem valor 0 COM regra (base reduzida a zero). */
export const calculoComRegra = {
  operacao: 'interestadual',
  itens: [
    item('i1', { regra_aplicada: { st: true, ipi: true }, calc_st: { v_bc: 12000, p_aliq: 180000, v_valor: 360 }, calc_ipi: { v_bc: 10000, p_aliq: 50000, v_valor: 500 } }),
    item('i2', { regra_aplicada: { st: true, ipi: true }, calc_st: { v_bc: 0, p_aliq: 180000, v_valor: 0 }, calc_ipi: { v_bc: 0, p_aliq: 50000, v_valor: 0 } }),
  ],
  totais: { ...totaisBase, v_st: 360, v_ipi: 500, calc_st: { v_bc: 12000, v_valor: 360 }, calc_ipi: { v_bc: 10000, v_valor: 500 } },
} as unknown as CalculoSaida;

/** Sem regra de ST nem de IPI: os campos novos são omitidos (nunca 0). */
export const calculoSemRegra = {
  operacao: 'interna',
  itens: [item('i1', { regra_aplicada: { st: false, ipi: false } })],
  totais: totaisBase,
} as unknown as CalculoSaida;

/** Item misto: o primeiro tem regra, o segundo não; o total de ST e de IPI é omitido. */
export const calculoItemMisto = {
  operacao: 'interna',
  itens: [
    item('i1', { regra_aplicada: { st: true, ipi: true }, calc_st: { v_bc: 12000, p_aliq: 180000, v_valor: 360 }, calc_ipi: { v_bc: 10000, p_aliq: 50000, v_valor: 500 } }),
    item('i2', { regra_aplicada: { st: false, ipi: false } }),
  ],
  totais: { ...totaisBase, v_st: 360, v_ipi: 500 },
} as unknown as CalculoSaida;
