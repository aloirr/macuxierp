import type { ErroFiscal, IcmsItem, ItemCalculo, RegraTributaria } from '../contracts';
import { ehCsosn } from './regra';
import { aplicarPercentual, BASE_PERCENTUAL, divArredonda } from './dinheiro';

/** Resolução do Senado 13/2012: 4% (40000) nas interestaduais de mercadoria importada (origens 1, 2, 3 e 8). */
export const ALIQUOTA_INTERESTADUAL_IMPORTADO = 40000;
const ORIGENS_IMPORTADAS = ['1', '2', '3', '8'];

/** Alíquota interestadual: 4% para origem 1/2/3/8; senão a da regra (7% ou 12% conforme as UFs, cadastrada na regra). */
export function aliquotaInterestadual(origem: string, aliquotaDaRegra: number | null): number | null {
  if (ORIGENS_IMPORTADAS.includes(origem)) return ALIQUOTA_INTERESTADUAL_IMPORTADO;
  return aliquotaDaRegra;
}

/** Base do ICMS próprio antes da redução: vProd + frete + seguro + outras − desconto (+ IPI quando `ipiNaBc`). Pode ser negativa (o chamador valida). */
export function baseIcms(item: ItemCalculo, ipiNaBc: boolean): number {
  return item.valor_bruto_centavos + item.frete_centavos + item.seguro_centavos + item.outras_despesas_centavos - item.desconto_centavos + (ipiNaBc ? item.ipi_centavos : 0);
}

/** Consumidor final ou destinatário não contribuinte: o IPI integra a BC do ICMS próprio. */
export function ipiEntraNaBc(tipo: string, consumidorFinal: boolean): boolean {
  return consumidorFinal || tipo !== 'contribuinte';
}

export interface EntradaIcms {
  base_centavos: number;
  /** décimos de milésimo de ponto percentual (4 casas); null = sem redução */
  reducao_bc: number | null;
  aliquota: number;
}
export interface SaidaIcms {
  v_bc: number;
  v_icms: number;
}

/** ICMS próprio: vBC = base × (1 − redução), vICMS = vBC × alíquota; cada valor arredondado ao centavo. */
export function calcularIcms(e: EntradaIcms): SaidaIcms {
  const red = BigInt(e.reducao_bc ?? 0);
  const v_bc = Number(divArredonda(BigInt(e.base_centavos) * (BASE_PERCENTUAL - red), BASE_PERCENTUAL));
  return { v_bc, v_icms: aplicarPercentual(v_bc, e.aliquota) };
}

/**
 * MVA ajustada (décimos de milésimo de %, 4 casas): [(1 + MVA) × (1 − ALQ inter) / (1 − ALQ intra)] − 1, arredondada a 4 casas (meio para cima).
 * Conv. ICMS 142/2018: se ALQ intra ≤ ALQ inter não há o que ajustar e vale a MVA original. Nunca divide por zero (intra = 100%)
 * e nunca devolve MVA negativa.
 */
export function mvaAjustada(mva: number, aliqInter: number, aliqIntra: number): number {
  if (aliqIntra <= aliqInter || aliqIntra >= Number(BASE_PERCENTUAL)) return mva;
  const num = (BASE_PERCENTUAL + BigInt(mva)) * (BASE_PERCENTUAL - BigInt(aliqInter));
  return Math.max(0, Number(divArredonda(num, BASE_PERCENTUAL - BigInt(aliqIntra)) - BASE_PERCENTUAL));
}

export interface EntradaIcmsSt {
  /** vProd + frete + seguro + outras − desconto + IPI (o IPI sempre compõe a BC do ST). */
  base_centavos: number;
  mva: number | null;
  reducao_bc_st: number | null;
  aliquota_st: number;
  /** ICMS próprio a abater (vICMS; no Simples, o ICMS nominal da operação, se informado). */
  v_icms_proprio: number;
}
export interface SaidaIcmsSt {
  v_bc_st: number;
  v_icms_st: number;
}

/** ICMS-ST: BC ST = base × (1 + MVA) × (1 − redução ST); vICMSST = BC ST × alíquota interna − ICMS próprio (mínimo 0). */
export function calcularIcmsSt(e: EntradaIcmsSt): SaidaIcmsSt {
  const mva = BigInt(e.mva ?? 0);
  const red = BigInt(e.reducao_bc_st ?? 0);
  const d = BASE_PERCENTUAL * BASE_PERCENTUAL;
  const v_bc_st = Number(divArredonda(BigInt(e.base_centavos) * (BASE_PERCENTUAL + mva) * (BASE_PERCENTUAL - red), d));
  const bruto = aplicarPercentual(v_bc_st, e.aliquota_st);
  return { v_bc_st, v_icms_st: Math.max(0, bruto - e.v_icms_proprio) };
}

export interface ContextoIcmsItem {
  item: ItemCalculo;
  regra: RegraTributaria;
  interestadual: boolean;
  /** IPI entra na BC do próprio (destinatário consumidor final/não contribuinte). */
  ipi_na_bc: boolean;
  /** Destinatário consumidor final não contribuinte (gera DIFAL na interestadual; não suportado no lote 1). */
  destinatario_nao_contribuinte_final?: boolean;
}

const SEM_CALCULO = ['40', '41', '50', '60', '102', '103', '300', '400', '500'];
const COM_PROPRIO = ['00', '10', '20', '70'];
const COM_ST = ['10', '30', '70', '201', '202', '203'];
/** CST 90 e CSOSN 900: calculam ICMS próprio/ST só se a regra trouxer a alíquota. */
const COM_ALIQ_OPCIONAL = ['90', '900'];

export type ResultadoIcmsItem = { ok: true; icms: IcmsItem } | { ok: false; codigo: Extract<ErroFiscal['codigo'], 'CODIGO_NAO_SUPORTADO' | 'REGRA_INCOMPLETA' | 'BASE_NEGATIVA'>; mensagem: string };

/** Monta o grupo ICMS do item conforme o CST/CSOSN da regra (RN-FIS-02). Os códigos 51 (diferimento) ficam para lote posterior. */
export function calcularIcmsItem(c: ContextoIcmsItem): ResultadoIcmsItem {
  const { item, regra } = c;
  const cod = regra.codigo;
  const simples = ehCsosn(cod);
  const icms: IcmsItem = { orig: item.origem, ...(simples ? { csosn: cod } : { cst: cod }) };
  if (item.desconto_centavos > item.valor_bruto_centavos) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor bruto do item.' };
  // DIFAL (ICMSUFDest) fica para um lote seguinte: venda interestadual a consumidor final não contribuinte não é calculada.
  if (c.interestadual && c.destinatario_nao_contribuinte_final) return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: 'Venda interestadual a consumidor final não contribuinte (DIFAL/ICMSUFDest) ainda não é calculada pelo motor.' };
  if (cod === '51') return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: 'CST 51 (diferimento) ainda não é calculado pelo motor.' };
  if (SEM_CALCULO.includes(cod)) return { ok: true, icms };

  const base = baseIcms(item, c.ipi_na_bc);
  if (base < 0) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor do item: base de cálculo negativa.' };

  // Alíquota do ICMS próprio (4% fixo nas interestaduais de importado).
  const aliqRegra = c.interestadual ? aliquotaInterestadual(item.origem, regra.aliquota_icms) : regra.aliquota_icms;

  // ICMS próprio (CST 00/10/20/70; 90 e CSOSN 900 só se a regra trouxer alíquota).
  let vIcmsProprio = 0;
  const proprio = COM_PROPRIO.includes(cod) || (COM_ALIQ_OPCIONAL.includes(cod) && aliqRegra !== null);
  if (proprio) {
    if (aliqRegra === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (código ${cod}) exige alíquota de ICMS.` };
    const r = calcularIcms({ base_centavos: base, reducao_bc: cod === '00' ? null : regra.reducao_bc, aliquota: aliqRegra });
    vIcmsProprio = r.v_icms;
    if (!simples) {
      icms.mod_bc = regra.mod_bc;
      if (regra.reducao_bc !== null && cod !== '00') icms.p_red_bc = regra.reducao_bc;
      icms.v_bc = r.v_bc;
      icms.p_icms = aliqRegra;
      icms.v_icms = r.v_icms;
      if (regra.p_fcp !== null) {
        icms.v_bc_fcp = r.v_bc;
        icms.p_fcp = regra.p_fcp;
        icms.v_fcp = aplicarPercentual(r.v_bc, regra.p_fcp);
      }
    }
  }

  // ST (CST 10/30/70, CSOSN 201/202/203; 90/900 se a regra trouxer alíquota interna do destino).
  const comSt = COM_ST.includes(cod) || (COM_ALIQ_OPCIONAL.includes(cod) && regra.aliquota_interna_destino !== null);
  if (comSt) {
    if (regra.aliquota_interna_destino === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (código ${cod}) exige a alíquota interna do destino para o ST.` };
    let mva = regra.mva_original;
    if (regra.mva_ajustada !== null && c.interestadual) mva = regra.mva_ajustada;
    else if (regra.ajustar_mva && c.interestadual && mva !== null) {
      if (aliqRegra === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} precisa da alíquota interestadual para ajustar a MVA.` };
      mva = mvaAjustada(mva, aliqRegra, regra.aliquota_interna_destino);
    }
    const baseSt = baseIcms(item, false) + item.ipi_centavos;
    // Simples: abate o ICMS nominal da operação (alíquota da regra), pois o grupo CSOSN não destaca vICMS.
    const abate = simples && regra.aliquota_icms !== null ? calcularIcms({ base_centavos: baseIcms(item, c.ipi_na_bc), reducao_bc: regra.reducao_bc, aliquota: aliqRegra ?? regra.aliquota_icms }).v_icms : vIcmsProprio;
    const st = calcularIcmsSt({ base_centavos: baseSt, mva, reducao_bc_st: regra.reducao_bc_st, aliquota_st: regra.aliquota_interna_destino, v_icms_proprio: cod === '30' ? 0 : abate });
    icms.mod_bc_st = regra.mod_bc_st ?? (mva !== null ? 4 : 0);
    if (mva !== null) icms.p_mva_st = mva;
    if (regra.reducao_bc_st !== null) icms.p_red_bc_st = regra.reducao_bc_st;
    icms.v_bc_st = st.v_bc_st;
    icms.p_icms_st = regra.aliquota_interna_destino;
    icms.v_icms_st = st.v_icms_st;
    if (regra.p_fcp_st !== null) {
      // NT 2016.002: também nos CSOSN 201/202/203. vFCPST = vBCFCPST × pFCPST − vFCP próprio (0 se não houver), nunca negativo.
      // Premissa: a BC do FCP-ST é a BC do ST; confirmar com a UF.
      icms.v_bc_fcp_st = st.v_bc_st;
      icms.p_fcp_st = regra.p_fcp_st;
      icms.v_fcp_st = Math.max(0, aplicarPercentual(st.v_bc_st, regra.p_fcp_st) - (icms.v_fcp ?? 0));
    }
  }

  // Crédito do Simples (CSOSN 101, 201 e 900 com pCredSN).
  if (['101', '201'].includes(cod) || (cod === '900' && regra.p_cred_sn !== null)) {
    if (regra.p_cred_sn === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (CSOSN ${cod}) exige pCredSN.` };
    icms.p_cred_sn = regra.p_cred_sn;
    icms.v_cred_icms_sn = aplicarPercentual(baseIcms(item, false), regra.p_cred_sn);
  }
  return { ok: true, icms };
}
