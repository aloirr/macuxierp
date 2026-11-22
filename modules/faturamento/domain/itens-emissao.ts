/**
 * Item da nota (cálculo do `fiscal.calculo@1`) no formato do item da `NotaParaEmissao` do `@macuxierp/nfe-emissor` (ADR 0002, T-0018:
 * o ÚNICO montador do XML). Função pura, em centavos. O que o emissor não monta (CST de ICMS 10/20/30/51/60/70/90, CSOSN 500/900, FCP,
 * IPI, PIS/COFINS por quantidade) vira violação ANTES da reserva do número (RF-FAT-01): nenhum número é queimado por nota que a SEFAZ
 * rejeitaria. Os totais NÃO entram: o emissor os calcula e confere (vProd e tributos, tolerância de R$ 0,01).
 */
import type { IcmsItem, ItemResultado } from '@macuxierp/fiscal/contracts';
import type { NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import { pisCofinsComValor, valoresFiscais, type NotaItemMontado } from './nota';
import { violacao, type Violacao } from './violacao';

type ItemEmissao = NotaParaEmissaoEntrada['itens'][number];
type Imposto = ItemEmissao['imposto'];

/** Texto da NF-e: sem espaço nas pontas nem espaços repetidos (o emissor recusa os dois). */
export const textoNfe = (s: string): string => s.trim().replace(/\s{2,}/g, ' ');

/** Alíquota em décimos de milésimo de ponto percentual (180000 = 18,0000%) → "18.0000", em inteiros. */
const pct = (p4: number): string => `${Math.trunc(p4 / 10_000)}.${String(p4 % 10_000).padStart(4, '0')}`;
/** Quantidade em escala 4 → "0.0000". */
const quantidade = (q4: number): string => `${Math.trunc(q4 / 10_000)}.${String(q4 % 10_000).padStart(4, '0')}`;
/** Preço unitário em centavos → "0.00". */
const unitario = (c: number): string => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;

const CSOSN_SEM_CREDITO = ['102', '103', '300', '400'] as const;
const CST_SEM_TRIBUTO = ['40', '41', '50'] as const;
const CST_PIS_NT = /^0[4-9]$/;

type Icms = Imposto['ICMS'];

const faltam = (o: object, campos: readonly string[]): string[] => campos.filter((c) => (o as Record<string, unknown>)[c] === undefined);

function icmsDe(c: IcmsItem, campo: string, v: Violacao[]): Icms | null {
  const exige = (campos: readonly string[], motivo: string): boolean => {
    const f = faltam(c, campos);
    if (f.length > 0) v.push(violacao('RF-FAT-01', campo, `${motivo} exige ${f.join(', ')} (fiscal.calculo@1).`));
    return f.length === 0;
  };
  const orig = Number(c.orig);
  const ST = ['mod_bc_st', 'v_bc_st', 'p_icms_st', 'v_icms_st'] as const;
  const st = () => ({
    modBCST: c.mod_bc_st ?? 4,
    ...(c.p_mva_st !== undefined ? { pMVAST: pct(c.p_mva_st) } : {}),
    ...(c.p_red_bc_st !== undefined ? { pRedBCST: pct(c.p_red_bc_st) } : {}),
    vBCST: c.v_bc_st ?? 0,
    pICMSST: pct(c.p_icms_st ?? 0),
    vICMSST: c.v_icms_st ?? 0,
    ...((c.v_fcp_st ?? 0) > 0 ? { FCPST: { vBCFCPST: c.v_bc_fcp_st ?? 0, pFCPST: pct(c.p_fcp_st ?? 0), vFCPST: c.v_fcp_st ?? 0 } } : {}),
  });
  if ((c.v_fcp_st ?? 0) > 0 && !exige(['v_bc_fcp_st', 'p_fcp_st'], 'FCP-ST')) return null;
  if (c.csosn) {
    const cs = c.csosn;
    if (cs === '101') return exige(['p_cred_sn', 'v_cred_icms_sn'], 'CSOSN 101') ? { CSOSN: '101', orig, pCredSN: pct(c.p_cred_sn ?? 0), vCredICMSSN: c.v_cred_icms_sn ?? 0 } : null;
    if (cs === '201') return exige([...ST, 'p_cred_sn', 'v_cred_icms_sn'], 'CSOSN 201') ? { CSOSN: '201', orig, ...st(), pCredSN: pct(c.p_cred_sn ?? 0), vCredICMSSN: c.v_cred_icms_sn ?? 0 } : null;
    if (cs === '202' || cs === '203') return exige(ST, `CSOSN ${cs}`) ? { CSOSN: cs, orig, ...st() } : null;
    if ((CSOSN_SEM_CREDITO as readonly string[]).includes(cs)) return { CSOSN: cs as (typeof CSOSN_SEM_CREDITO)[number], orig };
    v.push(violacao('RF-FAT-01', campo, `CSOSN ${cs} sem suporte (só 101, 102, 103, 201, 202, 203, 300 e 400; o 500 e o 900 pedem campos que o emissor ainda não monta a partir do cálculo).`));
    return null;
  }
  if (!c.cst) {
    v.push(violacao('RF-FAT-01', campo, 'ICMS sem CST nem CSOSN.'));
    return null;
  }
  if (c.cst === '00') {
    if ((c.v_fcp ?? 0) > 0) {
      v.push(violacao('RF-FAT-01', campo, 'FCP próprio (vFCP) sem suporte no emissor: a nota não é emitida com ele.'));
      return null;
    }
    return exige(['v_bc', 'p_icms', 'v_icms'], 'CST 00') ? { CST: '00', orig, modBC: c.mod_bc ?? 3, vBC: c.v_bc ?? 0, pICMS: pct(c.p_icms ?? 0), vICMS: c.v_icms ?? 0 } : null;
  }
  if ((CST_SEM_TRIBUTO as readonly string[]).includes(c.cst)) return { CST: c.cst as (typeof CST_SEM_TRIBUTO)[number], orig };
  v.push(violacao('RF-FAT-01', campo, `CST ${c.cst} sem suporte no emissor (só 00, 40, 41 e 50; 10, 20, 30, 51, 60, 70 e 90 não são montados ainda).`));
  return null;
}

type PisCofins = Imposto['PIS'];
function pisCofinsDe(nome: 'pis' | 'cofins', rotulo: string, g: ItemResultado['pis'], campo: (f: string) => string, v: Violacao[]): PisCofins | null {
  const valor = g?.v_valor ?? 0;
  if (!g?.cst) {
    if (valor > 0) {
      v.push(violacao('RF-FAT-01', campo(nome), `${rotulo} com valor exige cst (fiscal.calculo@1).`));
      return null;
    }
    return { CST: '99', vBC: 0, aliquota: '0', valor: 0 }; // sem grupo: Outr 99 zerado (MEI e Simples)
  }
  const cst = g.cst;
  if (CST_PIS_NT.test(cst)) {
    if (valor > 0) {
      v.push(violacao('RF-FAT-01', campo(nome), `${rotulo} CST ${cst} (não tributado) não leva valor.`));
      return null;
    }
    return { CST: cst as '04' };
  }
  if (cst === '01' || cst === '02' || pisCofinsComValor(cst)) {
    const f = faltam(g, ['v_bc', 'p_aliq']);
    if (f.length > 0 && valor > 0) {
      v.push(violacao('RF-FAT-01', campo(nome), `${rotulo} com valor exige ${f.join(', ')} (fiscal.calculo@1).`));
      return null;
    }
    return { CST: cst as '01', vBC: g.v_bc ?? 0, aliquota: pct(g.p_aliq ?? 0), valor };
  }
  v.push(violacao('RF-FAT-01', campo(nome), `${rotulo} CST ${cst} sem suporte (só 01, 02, 04 a 09 e 49 a 99; o 03, por quantidade, não é montado).`));
  return null;
}

/** IBS/CBS (UB12) e IS (UB01) do cálculo: o emissor aceita os grupos (NT 2025.002-RTC v1.53), então não há mais trava no faturamento. */
function rtcDe(r: ItemResultado, campo: (f: string) => string, v: Violacao[]): Pick<Imposto, 'IS' | 'IBSCBS'> {
  const saida: Pick<Imposto, 'IS' | 'IBSCBS'> = {};
  if ((r.ibs || r.cbs) && !r.ibs_cbs) v.push(violacao('RF-FAT-01', campo('ibs_cbs'), 'Grupos ibs/cbs são obsoletos no fiscal.calculo@1: use ibs_cbs.'));
  const g = r.ibs_cbs;
  if (g) {
    const comValor = g.v_bc !== undefined || g.g_ibs_uf || g.g_ibs_mun || g.g_cbs;
    if (!comValor) saida.IBSCBS = { CST: g.cst, cClassTrib: g.c_class_trib };
    else if (g.v_bc === undefined || !g.g_ibs_uf || !g.g_ibs_mun || !g.g_cbs) {
      v.push(violacao('RF-FAT-01', campo('ibs_cbs'), 'IBS/CBS exige v_bc, g_ibs_uf, g_ibs_mun e g_cbs (fiscal.calculo@1).'));
    } else {
      saida.IBSCBS = {
        CST: g.cst,
        cClassTrib: g.c_class_trib,
        gIBSCBS: {
          vBC: g.v_bc,
          pIBSUF: pct(g.g_ibs_uf.p_ibs_uf),
          vIBSUF: g.g_ibs_uf.v_ibs_uf,
          pIBSMun: pct(g.g_ibs_mun.p_ibs_mun),
          vIBSMun: g.g_ibs_mun.v_ibs_mun,
          pCBS: pct(g.g_cbs.p_cbs),
          vCBS: g.g_cbs.v_cbs,
        },
      };
    }
  }
  if (r.is) {
    const f = faltam(r.is, ['cst_is', 'c_class_trib_is', 'v_bc_is', 'p_is', 'v_is']);
    if (f.length > 0) v.push(violacao('RF-FAT-01', campo('is'), `IS exige ${f.join(', ')} (fiscal.calculo@1; o IS específico, por quantidade, não é montado).`));
    else saida.IS = { CSTIS: r.is.cst_is as string, cClassTribIS: r.is.c_class_trib_is as string, vBCIS: r.is.v_bc_is as number, pIS: pct(r.is.p_is as number), vIS: r.is.v_is as number };
  }
  return saida;
}

export type ResultadoItemEmissao = { ok: true; item: ItemEmissao } | { ok: false; violacoes: Violacao[] };

export function itemParaEmissao(i: NotaItemMontado): ResultadoItemEmissao {
  const v: Violacao[] = [];
  const r = i.calculo.resultado;
  const campo = (f: string): string => `itens.${i.sequencia}.${f}`;
  if (!/^\d{4}$/.test(i.calculo.cfop)) v.push(violacao('RF-FAT-01', campo('cfop'), 'CFOP ausente ou inválido.'));
  if (valoresFiscais(r).vIPI > 0) v.push(violacao('RF-FAT-01', campo('ipi'), 'IPI com valor sem suporte no emissor: a NotaParaEmissao não traz o grupo IPI.'));
  const ICMS = icmsDe(r.icms, campo('icms'), v);
  const PIS = pisCofinsDe('pis', 'PIS', r.pis, campo, v);
  const COFINS = pisCofinsDe('cofins', 'COFINS', r.cofins, campo, v);
  const rtc = rtcDe(r, campo, v);
  if (v.length > 0 || !ICMS || !PIS || !COFINS) return { ok: false, violacoes: v };
  return {
    ok: true,
    item: {
      cProd: textoNfe(i.codigo),
      cEAN: i.gtin ?? 'SEM GTIN',
      xProd: textoNfe(i.descricao),
      NCM: i.ncm.replace(/\D/g, ''),
      CFOP: i.calculo.cfop,
      uCom: textoNfe(i.unidade),
      qCom: quantidade(i.quantidade),
      vUnCom: unitario(i.preco_unitario_centavos),
      vProd: i.valor_produto_centavos,
      ...(i.frete_centavos > 0 ? { vFrete: i.frete_centavos } : {}),
      ...(i.desconto_centavos > 0 ? { vDesc: i.desconto_centavos } : {}),
      ...(i.outras_centavos > 0 ? { vOutro: i.outras_centavos } : {}),
      imposto: { ICMS, PIS, COFINS, ...rtc },
    },
  };
}
