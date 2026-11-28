import type { IcmsItem, IcmsUfDest, ImpostoCalculado, ItemCalculo, RegraTributaria } from '../contracts';
import type { CodigoErroCalculo } from './erros';
import { ehCsosn } from './regra';
import { aplicarPercentual, BASE_PERCENTUAL, divArredonda, valorOperacao } from './dinheiro';

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
  return valorOperacao(item) + (ipiNaBc ? item.ipi_centavos : 0);
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
  /** Destinatário consumidor final não contribuinte: na interestadual gera o DIFAL (ICMSUFDest, RN-FIS-06). */
  destinatario_nao_contribuinte_final?: boolean;
  /** Destinatário consumidor final: habilita o ICMS efetivo do ST retido (CST 60 / CSOSN 500 com `st_retido` e `p_icms_efet` na regra). */
  consumidor_final?: boolean;
}

const SEM_CALCULO = ['40', '41', '50', '60', '102', '103', '300', '400', '500'];
/** CST 60 e CSOSN 500: ICMS-ST retido anteriormente. */
const ST_RETIDO = ['60', '500'];
const COM_PROPRIO = ['00', '10', '20', '51', '70'];
const COM_ST = ['10', '30', '70', '201', '202', '203'];
/** CST 90 e CSOSN 900: calculam ICMS próprio/ST só se a regra trouxer a alíquota. */
const COM_ALIQ_OPCIONAL = ['90', '900'];

/** RN-FIS-06: CST/CSOSN em que o DIFAL é devido e calculado (ICMS próprio normal ou Simples sem ST). */
const COM_DIFAL = ['00', '20', '101', '102', '103'];
/** Sem ICMS a partilhar: isento, não tributado, suspenso, ST retido e CSOSN 300/400/500. Sem grupo ICMSUFDest. */
const SEM_DIFAL = ['40', '41', '50', '60', '300', '400', '500'];

/** Partilha 100% para o destino desde 2019 (EC 87/2015, art. 99 do ADCT). */
const PARTILHA_DESTINO = 1_000_000;

export type ResultadoIcmsItem = { ok: true; icms: IcmsItem; icms_uf_dest?: IcmsUfDest } | { ok: false; codigo: CodigoErroCalculo; mensagem: string };

/** Monta o grupo ICMS do item conforme o CST/CSOSN da regra (RN-FIS-02). CST 51 (diferimento) e ST retido (60/500) desde o lote 4. */
export function calcularIcmsItem(c: ContextoIcmsItem): ResultadoIcmsItem {
  const { item, regra } = c;
  const cod = regra.codigo ?? '';
  const simples = ehCsosn(cod);
  const icms: IcmsItem = { orig: item.origem, ...(simples ? { csosn: cod } : { cst: cod }) };
  if (item.desconto_centavos > item.valor_bruto_centavos) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor bruto do item.' };
  // DIFAL (RN-FIS-06): interestadual a consumidor final não contribuinte. Combinações sem fonte para calcular (ST, diferimento, CST 90/900, CSOSN 201/202/203) seguem recusadas.
  const difal = c.interestadual && c.destinatario_nao_contribuinte_final === true;
  if (difal && !COM_DIFAL.includes(cod) && !SEM_DIFAL.includes(cod)) {
    return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `DIFAL (ICMSUFDest) com o código ${cod} (ST, diferimento ou CST/CSOSN 90/900) ainda não é calculado pelo motor.` };
  }
  if (ST_RETIDO.includes(cod) && item.st_retido) {
    const { p_red_bc_efet, ...retido } = item.st_retido;
    // Os valores vêm da nota de compra: o motor só valida a coerência e repassa (erro da entrada, não da regra). FCP-ST retido: os três campos juntos ou nenhum.
    const fcp = [retido.v_bc_fcp_st_ret, retido.p_fcp_st_ret, retido.v_fcp_st_ret];
    if (fcp.some((x) => x !== undefined) && fcp.some((x) => x === undefined)) return { ok: false, codigo: 'ENTRADA_INVALIDA', mensagem: 'ST retido incoerente: o FCP-ST retido exige vBCFCPSTRet, pFCPSTRet e vFCPSTRet juntos.' };
    if (retido.v_icms_st_ret > retido.v_bc_st_ret || (retido.v_fcp_st_ret !== undefined && retido.v_bc_fcp_st_ret !== undefined && retido.v_fcp_st_ret > retido.v_bc_fcp_st_ret)) {
      return { ok: false, codigo: 'ENTRADA_INVALIDA', mensagem: 'ST retido incoerente: o valor retido é maior que a base de cálculo retida.' };
    }
    Object.assign(icms, retido);
    // ICMS efetivo (consumidor final): vBCEfet = valor da operação × (1 − pRedBCEfet); vICMSEfet = vBCEfet × pICMSEfet. Sem `p_icms_efet` na regra o grupo não sai.
    if (c.consumidor_final && regra.p_icms_efet !== null) {
      const e = calcularIcms({ base_centavos: valorOperacao(item), reducao_bc: p_red_bc_efet ?? null, aliquota: regra.p_icms_efet });
      Object.assign(icms, { p_red_bc_efet: p_red_bc_efet ?? 0, v_bc_efet: e.v_bc, p_icms_efet: regra.p_icms_efet, v_icms_efet: e.v_icms });
    }
  }
  // Sem st_retido o 60/500 sai só com orig e CST/CSOSN: os grupos de ST retido e de ICMS efetivo são opcionais no leiaute.
  if (SEM_CALCULO.includes(cod)) {
    // CSOSN 102/103 não calculam ICMS próprio, mas a venda interestadual a não contribuinte tem DIFAL (RN-FIS-06); os demais códigos daqui não têm ICMS a partilhar.
    if (difal && COM_DIFAL.includes(cod)) {
      const g = calcularDifal({ regra, aliq_inter: c.interestadual ? aliquotaInterestadual(item.origem, regra.aliquota_icms) : null, v_bc: calcularIcms({ base_centavos: baseIcms(item, c.ipi_na_bc), reducao_bc: regra.reducao_bc, aliquota: 0 }).v_bc });
      return g.ok ? { ok: true, icms, icms_uf_dest: g.grupo } : g;
    }
    return { ok: true, icms };
  }

  const base = baseIcms(item, c.ipi_na_bc);
  if (base < 0) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor do item: base de cálculo negativa.' };

  // Alíquota do ICMS próprio (4% fixo nas interestaduais de importado).
  const aliqRegra = c.interestadual ? aliquotaInterestadual(item.origem, regra.aliquota_icms) : regra.aliquota_icms;

  // ICMS próprio (CST 00/10/20/70; 90 e CSOSN 900 só se a regra trouxer alíquota).
  let vIcmsProprio = 0;
  const proprio = COM_PROPRIO.includes(cod) || (COM_ALIQ_OPCIONAL.includes(cod) && aliqRegra !== null);
  if (proprio) {
    if (aliqRegra === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (código ${cod}) exige alíquota de ICMS.` };
    if (cod === '51' && regra.p_dif === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (CST 51) exige o percentual de diferimento (p_dif).` };
    if (cod === '51' && regra.p_fcp !== null) return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: 'CST 51 com FCP (FCP diferido) ainda não é calculado: conferir na NT 2016.002 / homologação T-0046.' };
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
      if (cod === '51') {
        // Diferimento: vICMSOp = ICMS da operação (como se não houvesse diferimento); vICMS = vICMSOp − vICMSDif.
        const dif = aplicarPercentual(r.v_icms, regra.p_dif as number);
        icms.v_icms_op = r.v_icms;
        icms.p_dif = regra.p_dif as number;
        icms.v_icms_dif = dif;
        icms.v_icms = r.v_icms - dif;
      }
    }
  }

  // ST (CST 10/30/70, CSOSN 201/202/203; 90/900 se a regra trouxer alíquota interna do destino).
  const comSt = COM_ST.includes(cod) || (COM_ALIQ_OPCIONAL.includes(cod) && regra.aliquota_interna_destino !== null);
  if (comSt) {
    if (regra.aliquota_interna_destino === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (código ${cod}) exige a alíquota interna do destino para o ST.` };
    // Só o ST por MVA (modBCST 4, ou não informado) é calculado. Pauta/preço tabelado/lista (0..3 e 5) ainda não existem: recusar é melhor que errar a BC-ST.
    if (regra.mod_bc_st !== null && regra.mod_bc_st !== 4) return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `A regra ${regra.id} usa modBCST ${regra.mod_bc_st} (pauta, preço tabelado ou lista): o motor calcula o ST só por MVA (modBCST 4).` };
    // `ajustar_mva` não tem default no contrato: nulo é "não informado". Interestadual sem a decisão (e sem MVA ajustada cadastrada) não é calculado:
    // CODIGO_NAO_SUPORTADO (fail-closed, T-0127). Com false explícito vale a MVA original; intraestadual não ajusta.
    if (c.interestadual && (regra.ajustar_mva as boolean | null | undefined) == null && regra.mva_ajustada === null) return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `A regra ${regra.id} (ST interestadual) não diz se ajusta a MVA (ajustar_mva nulo): o motor não escolhe por ela.` };
    let mva = regra.mva_original;
    if (regra.mva_ajustada !== null && c.interestadual) mva = regra.mva_ajustada;
    else if (regra.ajustar_mva && c.interestadual && mva !== null) {
      if (aliqRegra === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} precisa da alíquota interestadual para ajustar a MVA.` };
      mva = mvaAjustada(mva, aliqRegra, regra.aliquota_interna_destino);
    }
    if (mva === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (código ${cod}) calcula ST por MVA mas não traz a MVA (original nem ajustada).` };
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
  if (difal && COM_DIFAL.includes(cod)) {
    const g = calcularDifal({ regra, aliq_inter: aliqRegra, v_bc: simples ? calcularIcms({ base_centavos: base, reducao_bc: regra.reducao_bc, aliquota: aliqRegra ?? 0 }).v_bc : (icms.v_bc ?? 0) });
    if (!g.ok) return g;
    return { ok: true, icms, icms_uf_dest: g.grupo };
  }
  return { ok: true, icms };
}

export interface EntradaDifal {
  regra: RegraTributaria;
  /** pICMSInter: a alíquota interestadual da operação (4% no importado, senão a da regra). */
  aliq_inter: number | null;
  /** BC do ICMS da operação (já com a redução da regra). */
  v_bc: number;
}

/**
 * RN-FIS-06 (EC 87/2015, LC 190/2022, Convênio ICMS 236/2021): ICMSUFDest da venda interestadual a consumidor final não contribuinte.
 * Base única: BC do destino = BC da operação. Base dupla: BC do destino = (BC − ICMS interestadual) / (1 − alíquota interna do destino), "por dentro".
 * vICMSUFDest = BC do destino × pICMSUFDest − vICMS interestadual (mínimo 0); vFCPUFDest = BC do destino × pFCPUFDest; partilha 100% destino (vICMSUFRemet = 0).
 * Nenhuma alíquota é inventada: interna do destino, FCP do destino (0 explícito) e a base (única ou dupla) vêm da regra, senão REGRA_INCOMPLETA.
 */
export function calcularDifal(e: EntradaDifal): { ok: true; grupo: IcmsUfDest } | { ok: false; codigo: CodigoErroCalculo; mensagem: string } {
  const { regra } = e;
  if (e.aliq_inter === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (DIFAL) exige a alíquota interestadual (aliquota_icms).` };
  if (regra.aliquota_interna_destino === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (DIFAL) exige a alíquota interna da UF de destino (aliquota_interna_destino).` };
  if (regra.p_fcp_uf_dest === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (DIFAL) exige o FCP da UF de destino (p_fcp_uf_dest; 0 se a UF não tem FCP).` };
  if (regra.difal_base_dupla === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (DIFAL) não diz se a base é única ou dupla (difal_base_dupla).` };
  const interna = regra.aliquota_interna_destino;
  if (interna >= Number(BASE_PERCENTUAL)) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${regra.id} (DIFAL) tem alíquota interna de 100% ou mais.` };
  const icmsInter = aplicarPercentual(e.v_bc, e.aliq_inter);
  const vBcDest = regra.difal_base_dupla
    ? Number(divArredonda(BigInt(e.v_bc) * (BASE_PERCENTUAL - BigInt(e.aliq_inter)), BASE_PERCENTUAL - BigInt(interna)))
    : e.v_bc;
  return {
    ok: true,
    grupo: {
      v_bc_uf_dest: vBcDest,
      v_bc_fcp_uf_dest: vBcDest,
      p_fcp_uf_dest: regra.p_fcp_uf_dest,
      p_icms_uf_dest: interna,
      p_icms_inter: e.aliq_inter,
      p_icms_inter_part: PARTILHA_DESTINO,
      v_fcp_uf_dest: aplicarPercentual(vBcDest, regra.p_fcp_uf_dest),
      v_icms_uf_dest: Math.max(0, aplicarPercentual(vBcDest, interna) - icmsInter),
      v_icms_uf_remet: 0,
    },
  };
}

/**
 * RN-FIS-05 (63 A): ICMS-ST calculado por regra (modBC ST, redução, MVA e alíquota interna do destino). Só existe quando o motor calculou o ST da
 * operação (grupo com `p_icms_st`); sem regra de ST, ou CST/CSOSN sem ST, devolve undefined e o campo sai omitido. O ST retido (60/500) é repasse
 * da nota de compra, não cálculo: não gera `calc_st`. O FCP-ST segue em `icms.v_fcp_st`.
 */
export function calcStDoIcms(icms: IcmsItem): ImpostoCalculado | undefined {
  if (icms.p_icms_st === undefined || icms.v_bc_st === undefined || icms.v_icms_st === undefined) return undefined;
  return { v_bc: icms.v_bc_st, p_aliq: icms.p_icms_st, v_valor: icms.v_icms_st };
}
