/**
 * Montagem do XML da NF-e modelo 55, leiaute 4.00, com os grupos IS e IBSCBS da NT 2025.002-RTC v1.53 (PL_010g,
 * "a conferir" na T-0046). Função pura: entrada validada → XML sem assinatura, na forma canônica.
 *
 * Porte em TypeScript da lógica do sped-nfe (`NFePHP\NFe\Make` e traits `TraitTag*`, v5.2.11, commit 4596b89),
 * opção MIT, com atribuição: Copyright (c) NFePHP — https://github.com/nfephp-org/sped-nfe.
 * Diferenças deliberadas do original: entrada em centavos (regra 4); totais sempre calculados aqui e nunca
 * aceitos de fora; só os grupos que a v1 do ERP usa (ICMS 00/40/41/50; Simples ICMSSN101, 102 [102/103/300/400],
 * 201, 202 [202/203], 500 e 900; PIS/COFINS Aliq, NT e Outr; ICMSUFDest; IS e IBS/CBS integral).
 */
import type { z } from 'zod';
import { NS_NFE, XNOME_HOMOLOGACAO, aammSefaz, dataHoraSefaz, montarChaveNFe } from '@macuxierp/nfe-sefaz';
import type { ModoArredondamento } from '@macuxierp/platform-sdk';
import { gerarCNF } from './chave';
import { aplicarAliquotaCentavos, centavosParaXml, decimalParaEscala, formatarEscala, multiplicarParaCentavos } from './decimal';
import { NotaParaEmissao } from './entrada';
import type { IcmsSimples, IcmsStSimples, IcmsUfDest, ItemNota, NotaParaEmissaoEntrada } from './entrada';
import { el, grupo, opt, serializar } from './xml';
import type { Elemento } from './xml';

const VERSAO_LEIAUTE = '4.00';

export class ErroMontagemNFe extends Error {
  constructor(
    readonly codigo: 'NFE_ENTRADA_INVALIDA' | 'NFE_VALOR_DIVERGENTE',
    /** Só caminhos e regras, nunca conteúdo (pode haver dado pessoal do destinatário). */
    readonly ocorrencias: readonly string[],
  ) {
    super(`${codigo}: ${ocorrencias.join('; ')}`);
    this.name = 'ErroMontagemNFe';
  }
}

/** Valida a entrada de um montador; o erro cita só caminhos e regras, nunca o conteúdo. */
export function validarEntrada<S extends z.ZodTypeAny>(schema: S, entrada: unknown): z.output<S> {
  const r = schema.safeParse(entrada);
  if (r.success) return r.data as z.output<S>;
  throw new ErroMontagemNFe('NFE_ENTRADA_INVALIDA', [...new Set(ocorrencias(r.error.issues))]);
}

/**
 * Caminho e mensagem de cada problema. Numa união de uniões discriminadas (ICMS por CST ou por CSOSN), cita só os
 * problemas do lado cujo discriminador casou (ex.: `ICMS.pCredSN` no CSOSN 101), em vez de "Invalid input".
 */
function ocorrencias(issues: readonly z.ZodIssue[]): string[] {
  return issues.flatMap((i) => {
    if (i.code === 'invalid_union') {
      const nivel = i.path.length + 1;
      const casou = i.unionErrors.filter((e) => !e.issues.some((x) => x.code === 'invalid_union_discriminator' && x.path.length === nivel));
      if (casou.length === 1) return ocorrencias(casou[0]!.issues);
    }
    return [`${i.path.join('.') || '(raiz)'}: ${i.message}`];
  });
}

export interface OpcoesMontagem {
  /** Gerador do cNF (inteiro em [0, max)); padrão `crypto.randomInt`. */
  aleatorio?: (max: number) => number;
  /** Tolerância da conferência de valores, em centavos (nota *4 do Anexo I: R$ 0,01). */
  toleranciaCentavos?: number;
}

export interface NFeMontada {
  /** XML da `NFe` sem assinatura, forma canônica, UTF-8 sem declaração. */
  xml: string;
  chave: string;
  cNF: string;
  /** dhEmi como foi para o XML (com deslocamento). */
  dhEmi: string;
}

const v = centavosParaXml;
const pct = (aliquota: string) => formatarEscala(decimalParaEscala(aliquota, 4), 4);
const qtd = (q: string) => formatarEscala(decimalParaEscala(q, 4), 4);
const unit = (u: string) => formatarEscala(decimalParaEscala(u, 10), 10);

/** ICMS próprio destacado no item: CST 00 ou CSOSN 900 com o sub-grupo do ICMS próprio. */
function icmsProprio(it: ItemNota): { vBC: number; pICMS: string; vICMS: number; caminho: string } | undefined {
  const icms = it.imposto.ICMS;
  if ('CST' in icms) return icms.CST === '00' ? { ...icms, caminho: '' } : undefined;
  return icms.CSOSN === '900' && icms.proprio ? { ...icms.proprio, caminho: 'proprio.' } : undefined;
}

/** ICMS-ST do item no Simples (CSOSN 201, 202/203 e o sub-grupo ST do 900); o regime normal da v1 não tem ST. */
function icmsSt(it: ItemNota): IcmsStSimples | undefined {
  const icms = it.imposto.ICMS;
  if (!('CSOSN' in icms)) return undefined;
  if (icms.CSOSN === '201' || icms.CSOSN === '202' || icms.CSOSN === '203') return icms;
  return icms.CSOSN === '900' ? icms.ST : undefined;
}

/** FCP retido anteriormente por ST (CSOSN 500). */
function fcpStRetido(it: ItemNota): number {
  const icms = it.imposto.ICMS;
  return 'CSOSN' in icms && icms.CSOSN === '500' ? (icms.FCPSTRet?.vFCPSTRet ?? 0) : 0;
}

/**
 * Confere vProd e tributos contra o calculado. Arredondamento (RN-CORE-03 e RN-FIS-03; adendo da ADR 0002): ICMS, PIS,
 * COFINS e vProd em meio para cima; IBS, CBS e IS em meio-para-par. `modoRtc` não é opção da montagem: o parâmetro
 * existe só para o teste de comparação chamar esta função direto (fora do `index`).
 */
export function conferirValores(nota: NotaParaEmissao, tol: number, modoRtc: ModoArredondamento = 'meio-para-par'): string[] {
  const erros: string[] = [];
  const confere = (caminho: string, informado: number, esperado: number) => {
    if (Math.abs(informado - esperado) > tol) erros.push(`${caminho}: difere do calculado (tolerância ${tol} centavo)`);
  };
  nota.itens.forEach((it, i) => {
    const c = `itens[${i}]`;
    confere(`${c}.vProd`, it.vProd, multiplicarParaCentavos(it.qCom, it.vUnCom));
    const proprio = icmsProprio(it);
    if (proprio) confere(`${c}.imposto.ICMS.${proprio.caminho}vICMS`, proprio.vICMS, aplicarAliquotaCentavos(proprio.vBC, proprio.pICMS, 'meio-para-cima'));
    for (const t of ['PIS', 'COFINS'] as const) {
      const g = it.imposto[t];
      if ('aliquota' in g) confere(`${c}.imposto.${t}.valor`, g.valor, aplicarAliquotaCentavos(g.vBC, g.aliquota, 'meio-para-cima'));
      if ('vAliqProd' in g) confere(`${c}.imposto.${t}.valor`, g.valor, multiplicarParaCentavos(g.qBCProd, g.vAliqProd));
    }
    const is = it.imposto.IS;
    if (is) confere(`${c}.imposto.IS.vIS`, is.vIS, aplicarAliquotaCentavos(is.vBCIS, is.pIS, modoRtc));
    const g = it.imposto.IBSCBS?.gIBSCBS;
    if (g) {
      confere(`${c}.imposto.IBSCBS.vIBSUF`, g.vIBSUF, aplicarAliquotaCentavos(g.vBC, g.pIBSUF, modoRtc));
      confere(`${c}.imposto.IBSCBS.vIBSMun`, g.vIBSMun, aplicarAliquotaCentavos(g.vBC, g.pIBSMun, modoRtc));
      confere(`${c}.imposto.IBSCBS.vCBS`, g.vCBS, aplicarAliquotaCentavos(g.vBC, g.pCBS, modoRtc));
    }
  });
  return erros;
}

function enderecoXml(nome: string, e: NotaParaEmissao['emit']['enderEmit']): Elemento {
  return grupo(nome, [
    el('xLgr', e.xLgr),
    el('nro', e.nro),
    opt('xCpl', e.xCpl),
    el('xBairro', e.xBairro),
    el('cMun', e.cMun),
    el('xMun', e.xMun),
    el('UF', e.UF),
    el('CEP', e.CEP),
    el('cPais', e.cPais),
    el('xPais', e.xPais),
    opt('fone', e.fone),
  ]);
}

function stXml(st: IcmsStSimples): Array<Elemento | undefined> {
  return [
    el('modBCST', String(st.modBCST)),
    opt('pMVAST', st.pMVAST && pct(st.pMVAST)),
    opt('pRedBCST', st.pRedBCST && pct(st.pRedBCST)),
    el('vBCST', v(st.vBCST)),
    el('pICMSST', pct(st.pICMSST)),
    el('vICMSST', v(st.vICMSST)),
    ...(st.FCPST ? [el('vBCFCPST', v(st.FCPST.vBCFCPST)), el('pFCPST', pct(st.FCPST.pFCPST)), el('vFCPST', v(st.FCPST.vFCPST))] : []),
  ];
}

const creditoXml = (c: { pCredSN: string; vCredICMSSN: number }): Elemento[] => [el('pCredSN', pct(c.pCredSN)), el('vCredICMSSN', v(c.vCredICMSSN))];

/** Grupo do Simples na ordem do XSD (PL_010g, leiauteNFe_v4.00.xsd, linhas 3911–4400). */
function icmsSnXml(icms: IcmsSimples): Elemento {
  const base = [el('orig', String(icms.orig)), el('CSOSN', icms.CSOSN)];
  switch (icms.CSOSN) {
    case '101':
      return grupo('ICMSSN101', [...base, ...creditoXml(icms)]);
    case '102':
    case '103':
    case '300':
    case '400':
      return grupo('ICMSSN102', base);
    case '201':
      return grupo('ICMSSN201', [...base, ...stXml(icms), ...creditoXml(icms)]);
    case '202':
    case '203':
      return grupo('ICMSSN202', [...base, ...stXml(icms)]);
    case '500': {
      const r = icms.STRet;
      const f = icms.FCPSTRet;
      return grupo('ICMSSN500', [
        ...base,
        ...(r ? [el('vBCSTRet', v(r.vBCSTRet)), el('pST', pct(r.pST)), r.vICMSSubstituto !== undefined ? el('vICMSSubstituto', v(r.vICMSSubstituto)) : undefined, el('vICMSSTRet', v(r.vICMSSTRet))] : []),
        ...(f ? [el('vBCFCPSTRet', v(f.vBCFCPSTRet)), el('pFCPSTRet', pct(f.pFCPSTRet)), el('vFCPSTRet', v(f.vFCPSTRet))] : []),
      ]);
    }
    case '900': {
      const p = icms.proprio;
      return grupo('ICMSSN900', [
        ...base,
        ...(p ? [el('modBC', String(p.modBC)), el('vBC', v(p.vBC)), opt('pRedBC', p.pRedBC && pct(p.pRedBC)), el('pICMS', pct(p.pICMS)), el('vICMS', v(p.vICMS))] : []),
        ...(icms.ST ? stXml(icms.ST) : []),
        ...(icms.credito ? creditoXml(icms.credito) : []),
      ]);
    }
  }
}

function icmsXml(icms: ItemNota['imposto']['ICMS']): Elemento {
  if ('CSOSN' in icms) return grupo('ICMS', [icmsSnXml(icms)]);
  if (icms.CST === '00') {
    return grupo('ICMS', [
      grupo('ICMS00', [el('orig', String(icms.orig)), el('CST', '00'), el('modBC', String(icms.modBC)), el('vBC', v(icms.vBC)), el('pICMS', pct(icms.pICMS)), el('vICMS', v(icms.vICMS))]),
    ]);
  }
  return grupo('ICMS', [grupo('ICMS40', [el('orig', String(icms.orig)), el('CST', icms.CST)])]);
}

/** PIS e COFINS: `<T>Aliq` (01/02), `<T>NT` (04–09) e `<T>Outr` (49–99, base em % ou por quantidade, aceita zero). */
function pisCofinsXml(tributo: 'PIS' | 'COFINS', g: ItemNota['imposto']['PIS']): Elemento {
  if (!('valor' in g)) return grupo(tributo, [grupo(`${tributo}NT`, [el('CST', g.CST)])]);
  const base = 'aliquota' in g ? [el('vBC', v(g.vBC)), el(`p${tributo}`, pct(g.aliquota))] : [el('qBCProd', qtd(g.qBCProd)), el('vAliqProd', qtd(g.vAliqProd))];
  const nome = g.CST === '01' || g.CST === '02' ? `${tributo}Aliq` : `${tributo}Outr`;
  return grupo(tributo, [grupo(nome, [el('CST', g.CST), ...base, el(`v${tributo}`, v(g.valor))])]);
}

/** ICMSUFDest (NA01) na ordem do XSD do PL_010g (leiauteNFe_v4.00.xsd:5145); o pICMSInter vai com 2 casas (enumeração). */
function icmsUfDestXml(g: IcmsUfDest): Elemento {
  return grupo('ICMSUFDest', [
    el('vBCUFDest', v(g.vBCUFDest)),
    g.vBCFCPUFDest !== undefined ? el('vBCFCPUFDest', v(g.vBCFCPUFDest)) : undefined,
    opt('pFCPUFDest', g.pFCPUFDest && pct(g.pFCPUFDest)),
    el('pICMSUFDest', pct(g.pICMSUFDest)),
    el('pICMSInter', formatarEscala(decimalParaEscala(g.pICMSInter, 2), 2)),
    el('pICMSInterPart', pct(g.pICMSInterPart)),
    g.vFCPUFDest !== undefined ? el('vFCPUFDest', v(g.vFCPUFDest)) : undefined,
    el('vICMSUFDest', v(g.vICMSUFDest)),
    el('vICMSUFRemet', v(g.vICMSUFRemet)),
  ]);
}

function isXml(is: NonNullable<ItemNota['imposto']['IS']>): Elemento {
  return grupo('IS', [el('CSTIS', is.CSTIS), el('cClassTribIS', is.cClassTribIS), el('vBCIS', v(is.vBCIS)), el('pIS', pct(is.pIS)), el('vIS', v(is.vIS))]);
}

function ibsCbsXml(t: NonNullable<ItemNota['imposto']['IBSCBS']>): Elemento {
  const g = t.gIBSCBS;
  return grupo('IBSCBS', [
    el('CST', t.CST),
    el('cClassTrib', t.cClassTrib),
    g &&
      grupo('gIBSCBS', [
        el('vBC', v(g.vBC)),
        grupo('gIBSUF', [el('pIBSUF', pct(g.pIBSUF)), el('vIBSUF', v(g.vIBSUF))]),
        grupo('gIBSMun', [el('pIBSMun', pct(g.pIBSMun)), el('vIBSMun', v(g.vIBSMun))]),
        el('vIBS', v(g.vIBSUF + g.vIBSMun)),
        grupo('gCBS', [el('pCBS', pct(g.pCBS)), el('vCBS', v(g.vCBS))]),
      ]),
  ]);
}

/**
 * Valor total do item (vItem, grupo VB da NT 2025.002-RTC) no subconjunto do spike: vProd - vDesc + vICMSST + vFCPST +
 * vFrete + vSeg + vOutro (sem IPI, II e desoneração; igual ao `calculateTtensValues1` do sped-nfe). IS, IBS e CBS entram só com fato gerador a partir de 2027 (regra VB01-10,
 * fonte secundária: sinete `reforma.json`). "A conferir" na T-0046.
 */
function valorDoItem(it: ItemNota, comTributosRtc: boolean): number {
  const st = icmsSt(it);
  const base = it.vProd - (it.vDesc ?? 0) + (st?.vICMSST ?? 0) + (st?.FCPST?.vFCPST ?? 0) + (it.vFrete ?? 0) + (it.vSeg ?? 0) + (it.vOutro ?? 0);
  if (!comTributosRtc) return base;
  const g = it.imposto.IBSCBS?.gIBSCBS;
  return base + (it.imposto.IS?.vIS ?? 0) + (g ? g.vIBSUF + g.vIBSMun + g.vCBS : 0);
}

function detXml(it: ItemNota, nItem: number, comTributosRtc: boolean): Elemento {
  const im = it.imposto;
  return grupo(
    'det',
    [
      grupo('prod', [
        el('cProd', it.cProd),
        el('cEAN', it.cEAN),
        el('xProd', it.xProd),
        el('NCM', it.NCM),
        opt('CEST', it.CEST),
        el('CFOP', it.CFOP),
        el('uCom', it.uCom),
        el('qCom', qtd(it.qCom)),
        el('vUnCom', unit(it.vUnCom)),
        el('vProd', v(it.vProd)),
        el('cEANTrib', it.cEAN),
        el('uTrib', it.uCom),
        el('qTrib', qtd(it.qCom)),
        el('vUnTrib', unit(it.vUnCom)),
        it.vFrete ? el('vFrete', v(it.vFrete)) : undefined,
        it.vSeg ? el('vSeg', v(it.vSeg)) : undefined,
        it.vDesc ? el('vDesc', v(it.vDesc)) : undefined,
        it.vOutro ? el('vOutro', v(it.vOutro)) : undefined,
        el('indTot', String(it.indTot)),
      ]),
      grupo('imposto', [
        im.vTotTrib !== undefined ? el('vTotTrib', v(im.vTotTrib)) : undefined,
        icmsXml(im.ICMS),
        pisCofinsXml('PIS', im.PIS),
        pisCofinsXml('COFINS', im.COFINS),
        im.ICMSUFDest && icmsUfDestXml(im.ICMSUFDest),
        im.IS && isXml(im.IS),
        im.IBSCBS && ibsCbsXml(im.IBSCBS),
      ]),
      opt('infAdProd', it.infAdProd),
      el('vItem', v(valorDoItem(it, comTributosRtc))),
    ],
    { nItem: String(nItem) },
  );
}

interface Totais {
  vBC: number;
  vICMS: number;
  vBCST: number;
  vST: number;
  vFCPST: number;
  vFCPSTRet: number;
  vProd: number;
  vFrete: number;
  vSeg: number;
  vDesc: number;
  vPIS: number;
  vCOFINS: number;
  vOutro: number;
  vNF: number;
  /** vNFTot (W60): soma dos vItem. */
  vNFTot: number;
  vTotTrib: number | undefined;
  /** Totais do ICMSUFDest (W04c, W04e e W04g), só quando algum item traz o grupo. */
  icmsUfDest: { vFCPUFDest: number; vICMSUFDest: number; vICMSUFRemet: number } | undefined;
  vIS: number | undefined;
  ibsCbs: { vBC: number; vIBSUF: number; vIBSMun: number; vCBS: number } | undefined;
}

/**
 * Totais (grupo W): sempre calculados a partir dos itens (sem IPI, II e desoneração no spike). Simples (sped-nfe,
 * `tagICMSSN`): vBC e vICMS só do ICMS próprio (CST 00 e CSOSN 900 com o sub-grupo), 0 nos demais CSOSN; vBCST, vST e
 * vFCPST do 201, 202/203 e 900; vFCPSTRet do 500. vST e vFCPST entram no vNF. Os totais do ICMSUFDest (DIFAL) ficam
 * fora do vNF e do vItem: se entram é decisão pendente do modulo-fiscal e do faturamento (T-0128).
 */
function calcularTotais(itens: readonly ItemNota[], comTributosRtc = false): Totais {
  const soma = (f: (it: ItemNota) => number | undefined) => itens.reduce((s, it) => s + (f(it) ?? 0), 0);
  const noTotal = (f: (it: ItemNota) => number | undefined) => (it: ItemNota) => (it.indTot === 1 ? f(it) : 0);
  const t = {
    vBC: soma((it) => icmsProprio(it)?.vBC),
    vICMS: soma((it) => icmsProprio(it)?.vICMS),
    vBCST: soma((it) => icmsSt(it)?.vBCST),
    vST: soma((it) => icmsSt(it)?.vICMSST),
    vFCPST: soma((it) => icmsSt(it)?.FCPST?.vFCPST),
    vFCPSTRet: soma(fcpStRetido),
    vProd: soma(noTotal((it) => it.vProd)),
    vFrete: soma((it) => it.vFrete),
    vSeg: soma((it) => it.vSeg),
    vDesc: soma((it) => it.vDesc),
    vPIS: soma((it) => ('valor' in it.imposto.PIS ? it.imposto.PIS.valor : 0)),
    vCOFINS: soma((it) => ('valor' in it.imposto.COFINS ? it.imposto.COFINS.valor : 0)),
    vOutro: soma((it) => it.vOutro),
  };
  const vNF = t.vProd - t.vDesc + t.vST + t.vFCPST + t.vFrete + t.vSeg + t.vOutro;
  const comTotTrib = itens.some((it) => it.imposto.vTotTrib !== undefined);
  const comIs = itens.some((it) => it.imposto.IS);
  const comIcmsUfDest = itens.some((it) => it.imposto.ICMSUFDest);
  const comIbsCbs = itens.some((it) => it.imposto.IBSCBS);
  return {
    ...t,
    vNF,
    vNFTot: soma(noTotal((it) => valorDoItem(it, comTributosRtc))),
    vTotTrib: comTotTrib ? soma((it) => it.imposto.vTotTrib) : undefined,
    icmsUfDest: comIcmsUfDest
      ? {
          vFCPUFDest: soma((it) => it.imposto.ICMSUFDest?.vFCPUFDest),
          vICMSUFDest: soma((it) => it.imposto.ICMSUFDest?.vICMSUFDest),
          vICMSUFRemet: soma((it) => it.imposto.ICMSUFDest?.vICMSUFRemet),
        }
      : undefined,
    vIS: comIs ? soma((it) => it.imposto.IS?.vIS) : undefined,
    ibsCbs: comIbsCbs
      ? {
          vBC: soma((it) => it.imposto.IBSCBS?.gIBSCBS?.vBC),
          vIBSUF: soma((it) => it.imposto.IBSCBS?.gIBSCBS?.vIBSUF),
          vIBSMun: soma((it) => it.imposto.IBSCBS?.gIBSCBS?.vIBSMun),
          vCBS: soma((it) => it.imposto.IBSCBS?.gIBSCBS?.vCBS),
        }
      : undefined,
  };
}

function totalXml(t: Totais): Elemento {
  const zero = v(0);
  const ib = t.ibsCbs;
  const difal = t.icmsUfDest;
  return grupo('total', [
    grupo('ICMSTot', [
      el('vBC', v(t.vBC)),
      el('vICMS', v(t.vICMS)),
      el('vICMSDeson', zero),
      ...(difal ? [el('vFCPUFDest', v(difal.vFCPUFDest)), el('vICMSUFDest', v(difal.vICMSUFDest)), el('vICMSUFRemet', v(difal.vICMSUFRemet))] : []),
      el('vFCP', zero),
      el('vBCST', v(t.vBCST)),
      el('vST', v(t.vST)),
      el('vFCPST', v(t.vFCPST)),
      el('vFCPSTRet', v(t.vFCPSTRet)),
      el('vProd', v(t.vProd)),
      el('vFrete', v(t.vFrete)),
      el('vSeg', v(t.vSeg)),
      el('vDesc', v(t.vDesc)),
      el('vII', zero),
      el('vIPI', zero),
      el('vIPIDevol', zero),
      el('vPIS', v(t.vPIS)),
      el('vCOFINS', v(t.vCOFINS)),
      el('vOutro', v(t.vOutro)),
      el('vNF', v(t.vNF)),
      t.vTotTrib !== undefined ? el('vTotTrib', v(t.vTotTrib)) : undefined,
    ]),
    t.vIS !== undefined ? grupo('ISTot', [el('vIS', v(t.vIS))]) : undefined,
    ib &&
      grupo('IBSCBSTot', [
        el('vBCIBSCBS', v(ib.vBC)),
        grupo('gIBS', [
          grupo('gIBSUF', [el('vDif', zero), el('vDevTrib', zero), el('vIBSUF', v(ib.vIBSUF))]),
          grupo('gIBSMun', [el('vDif', zero), el('vDevTrib', zero), el('vIBSMun', v(ib.vIBSMun))]),
          el('vIBS', v(ib.vIBSUF + ib.vIBSMun)),
          el('vCredPres', zero),
          el('vCredPresCondSus', zero),
        ]),
        grupo('gCBS', [el('vDif', zero), el('vDevTrib', zero), el('vCBS', v(ib.vCBS)), el('vCredPres', zero), el('vCredPresCondSus', zero)]),
      ]),
    el('vNFTot', v(t.vNFTot)),
  ]);
}

/** Monta a NF-e sem assinatura. Lança `ErroMontagemNFe` com os caminhos do que falhou. */
export function montarNFe(entrada: NotaParaEmissaoEntrada, opcoes: OpcoesMontagem = {}): NFeMontada {
  const nota = validarEntrada(NotaParaEmissao, entrada);
  const divergencias = conferirValores(nota, opcoes.toleranciaCentavos ?? 1);
  if (divergencias.length > 0) throw new ErroMontagemNFe('NFE_VALOR_DIVERGENTE', divergencias);

  const { ide, emit, dest } = nota;
  const dhEmi = dataHoraSefaz(new Date(ide.dhEmi), ide.fusoMinutos);
  const cNF = ide.cNF ?? gerarCNF(ide.nNF, opcoes.aleatorio);
  const chave = montarChaveNFe({
    cUF: Number(ide.cUF),
    aamm: aammSefaz(dhEmi),
    cnpj: emit.CNPJ,
    mod: '55',
    serie: ide.serie,
    nNF: ide.nNF,
    tpEmis: ide.tpEmis,
    cNF,
  });
  const cDV = chave.slice(-1);
  // IS/IBS/CBS somam no vItem e no vNFTot só com fato gerador a partir de 2027 (a conferir, T-0046).
  const comTributosRtc = Number(dhEmi.slice(0, 4)) >= 2027;
  const totais = calcularTotais(nota.itens, comTributosRtc);

  const infNFe = grupo(
    'infNFe',
    [
      grupo('ide', [
        el('cUF', ide.cUF),
        el('cNF', cNF),
        el('natOp', ide.natOp),
        el('mod', '55'),
        el('serie', String(ide.serie)),
        el('nNF', String(ide.nNF)),
        el('dhEmi', dhEmi),
        el('tpNF', String(ide.tpNF)),
        el('idDest', String(ide.idDest)),
        el('cMunFG', ide.cMunFG),
        opt('cMunFGIBS', ide.cMunFGIBS),
        el('tpImp', String(ide.tpImp)),
        el('tpEmis', String(ide.tpEmis)),
        el('cDV', cDV),
        el('tpAmb', String(ide.tpAmb)),
        el('finNFe', String(ide.finNFe)),
        el('indFinal', String(ide.indFinal)),
        el('indPres', String(ide.indPres)),
        ide.indIntermed !== undefined ? el('indIntermed', String(ide.indIntermed)) : undefined,
        el('procEmi', '0'),
        el('verProc', ide.verProc),
        // Contingência (ADR 0011): na ordem do schema, depois do verProc; a entrada garante os dois juntos.
        ide.dhCont !== undefined ? el('dhCont', dataHoraSefaz(new Date(ide.dhCont), ide.fusoMinutos)) : undefined,
        opt('xJust', ide.xJust),
      ]),
      grupo('emit', [
        el('CNPJ', emit.CNPJ),
        el('xNome', emit.xNome),
        opt('xFant', emit.xFant),
        enderecoXml('enderEmit', emit.enderEmit),
        el('IE', emit.IE),
        el('CRT', String(emit.CRT)),
      ]),
      dest &&
        grupo('dest', [
          opt('CNPJ', dest.CNPJ),
          opt('CPF', dest.CPF),
          el('xNome', ide.tpAmb === 2 ? XNOME_HOMOLOGACAO : dest.xNome),
          enderecoXml('enderDest', dest.enderDest),
          el('indIEDest', String(dest.indIEDest)),
          opt('IE', dest.IE),
          opt('email', dest.email),
        ]),
      ...nota.itens.map((it, i) => detXml(it, i + 1, comTributosRtc)),
      totalXml(totais),
      grupo('transp', [el('modFrete', String(nota.transp.modFrete))]),
      grupo('pag', [
        ...nota.pag.detPag.map((p) =>
          grupo('detPag', [p.indPag !== undefined ? el('indPag', String(p.indPag)) : undefined, el('tPag', p.tPag), opt('xPag', p.xPag), el('vPag', v(p.vPag))]),
        ),
        nota.pag.vTroco !== undefined ? el('vTroco', v(nota.pag.vTroco)) : undefined,
      ]),
      nota.infAdic && grupo('infAdic', [el('infCpl', nota.infAdic.infCpl)]),
      nota.infRespTec &&
        grupo('infRespTec', [
          el('CNPJ', nota.infRespTec.CNPJ),
          el('xContato', nota.infRespTec.xContato),
          el('email', nota.infRespTec.email),
          el('fone', nota.infRespTec.fone),
        ]),
    ],
    { Id: `NFe${chave}`, versao: VERSAO_LEIAUTE },
  );
  const xml = serializar({ nome: 'NFe', xmlns: NS_NFE, filhos: [infNFe] });
  return { xml, chave, cNF, dhEmi };
}
