/**
 * Notas de entrada do spike (sem dado pessoal: empresas e endereços fictícios, CNPJ com DV válido inventado).
 * São as entradas da comparação do spike (desenho T-0018 §3.2 e §6.2).
 * Alíquotas de IBS/CBS de 2026 (ano de teste: CBS 0,9%, IBS UF 0,1%, IBS Mun 0) — "a conferir" na T-0046.
 */
import { CNPJ_EMITENTE_DE_TESTE, CNPJ_OUTRO_DE_TESTE, INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import type { NotaParaEmissaoEntrada } from '../entrada';

type Item = NotaParaEmissaoEntrada['itens'][number];

const enderecoEmit = {
  xLgr: 'RUA FICTICIA DO TESTE',
  nro: '100',
  xBairro: 'DISTRITO INDUSTRIAL',
  cMun: '1302603',
  xMun: 'Manaus',
  UF: 'AM',
  CEP: '69075000',
};

const BASE = {
  ide: {
    cUF: '13',
    natOp: 'VENDA DE MERCADORIA',
    serie: 1,
    nNF: 1,
    dhEmi: INSTANTE_DE_TESTE.toISOString(),
    fusoMinutos: -240,
    tpNF: 1,
    idDest: 1,
    cMunFG: '1302603',
    tpAmb: 2,
    indFinal: 0,
    indPres: 1,
    verProc: 'macuxi-erp 0.1',
    cNF: '48213705',
  },
  emit: { CNPJ: CNPJ_EMITENTE_DE_TESTE, xNome: 'EMPRESA FICTICIA DE TESTE LTDA', enderEmit: enderecoEmit, IE: '041234561', CRT: 3 },
  dest: {
    CNPJ: CNPJ_OUTRO_DE_TESTE,
    xNome: 'CLIENTE FICTICIO LTDA',
    enderDest: { ...enderecoEmit, xLgr: 'AVENIDA DE TESTE', nro: '200', xBairro: 'CENTRO' },
    indIEDest: 1,
    IE: '049876546',
  },
  transp: { modFrete: 9 },
} as const satisfies Partial<NotaParaEmissaoEntrada>;

/** Item tributado: ICMS 00, PIS/COFINS alíquota, IBS/CBS integral. Valores em centavos. */
export function itemTributado(n: number, q = '2', vUn = '10.5', aliqIcms = '20'): Item {
  const vProd = Math.round(Number(q) * Number(vUn) * 100); // fixture simples: q×vUn sem meio centavo
  const pct = (base: number, a: number) => Math.round((base * a) / 100);
  return {
    cProd: `P${String(n).padStart(4, '0')}`,
    xProd: `PRODUTO DE TESTE ${n}`,
    NCM: '22021000',
    CFOP: '5102',
    uCom: 'UN',
    qCom: q,
    vUnCom: vUn,
    vProd,
    imposto: {
      ICMS: { CST: '00', orig: 0, modBC: 3, vBC: vProd, pICMS: aliqIcms, vICMS: pct(vProd, Number(aliqIcms)) },
      PIS: { CST: '01', vBC: vProd, aliquota: '1.65', valor: pct(vProd, 1.65) },
      COFINS: { CST: '01', vBC: vProd, aliquota: '7.6', valor: pct(vProd, 7.6) },
      IBSCBS: {
        CST: '000',
        cClassTrib: '000001',
        gIBSCBS: { vBC: vProd, pIBSUF: '0.1', vIBSUF: pct(vProd, 0.1), pIBSMun: '0', vIBSMun: 0, pCBS: '0.9', vCBS: pct(vProd, 0.9) },
      },
    },
  };
}

function nota(itens: Item[], extra: Partial<NotaParaEmissaoEntrada> = {}): NotaParaEmissaoEntrada {
  const vProd = itens.reduce((s, i) => s + i.vProd - (i.vDesc ?? 0) + (i.vFrete ?? 0), 0);
  return { ...BASE, itens, pag: { detPag: [{ indPag: 0, tPag: '01', vPag: vProd }] }, ...extra };
}

/** Venda simples dentro do AM. */
export const vendaSimplesAm = nota([itemTributado(1)]);

/** Venda interestadual (AM → PA), ICMS 12%. */
export const vendaInterestadual = nota([{ ...itemTributado(1, '3', '33.3', '12'), CFOP: '6102' }], {
  ide: { ...BASE.ide, idDest: 2 },
  dest: { ...BASE.dest, enderDest: { ...BASE.dest.enderDest, cMun: '1501402', xMun: 'Belem', UF: 'PA', CEP: '66010000' }, IE: '151234566' },
});

/**
 * Venda interestadual (AM → PA) a consumidor final não contribuinte (idDest 2, indFinal 1, indIEDest 9) com o
 * ICMSUFDest pronto, como viria do modulo-fiscal: base 99,90; 19% − 12% = 7% → 6,99; FCP 2% → 2,00.
 */
export const ICMS_UF_DEST_DE_TESTE = {
  vBCUFDest: 9990,
  vBCFCPUFDest: 9990,
  pFCPUFDest: '2',
  pICMSUFDest: '19',
  pICMSInter: '12',
  vFCPUFDest: 200,
  vICMSUFDest: 699,
  vICMSUFRemet: 0,
} as const satisfies NonNullable<Item['imposto']['ICMSUFDest']>;

const itemDifal = itemTributado(1, '3', '33.3', '12');
export const vendaInterestadualConsumidorFinal = nota([{ ...itemDifal, CFOP: '6108', imposto: { ...itemDifal.imposto, ICMSUFDest: ICMS_UF_DEST_DE_TESTE } }], {
  ide: { ...BASE.ide, idDest: 2, indFinal: 1 },
  dest: { CNPJ: BASE.dest.CNPJ, xNome: BASE.dest.xNome, enderDest: { ...BASE.dest.enderDest, cMun: '1501402', xMun: 'Belem', UF: 'PA', CEP: '66010000' }, indIEDest: 9 },
});

/** Nota com Imposto Seletivo (bebida açucarada, NCM 2202): grupo IS e ISTot. */
export const notaComIs = nota([
  {
    ...itemTributado(1, '12', '4.25'),
    imposto: { ...itemTributado(1, '12', '4.25').imposto, IS: { CSTIS: '000', cClassTribIS: '000001', vBCIS: 5100, pIS: '2', vIS: 102 } },
  },
]);

/** Nota com desconto e frete no item. */
export const notaComDescontoEFrete = nota([{ ...itemTributado(1, '5', '20'), vDesc: 1000, vFrete: 1500 }]);

/** Nota com 50 itens. */
export const nota50Itens = nota(Array.from({ length: 50 }, (_, i) => itemTributado(i + 1, String((i % 7) + 1), `${(i % 13) + 1}.25`)));

export const NOTAS = { vendaSimplesAm, vendaInterestadual, notaComIs, notaComDescontoEFrete, nota50Itens } as const;

// ---------- Simples Nacional e MEI (CRT 1 e 4; NT 2024.001) ----------
// Os valores de ST, FCP e crédito vêm prontos (cálculo do modulo-fiscal, T-0020); aqui só alimentam a montagem.

type Icms = Item['imposto']['ICMS'];
type PisCofins = Item['imposto']['PIS'];

/** PIS e COFINS do Simples/MEI: CST 99 (PISOutr/COFINSOutr) com base, alíquota e valor zerados. */
export const PIS_COFINS_99_ZERADO = { CST: '99', vBC: 0, aliquota: '0', valor: 0 } as const satisfies PisCofins;

/** ST de exemplo: base 29,40 (MVA 40% sobre 21,00), 20% → 5,88 − ICMS próprio nominal 4,20 = 1,68; FCP-ST 2% = 0,59. */
const ST_DE_TESTE = {
  modBCST: 4,
  pMVAST: '40',
  vBCST: 2940,
  pICMSST: '20',
  vICMSST: 168,
  FCPST: { vBCFCPST: 2940, pFCPST: '2', vFCPST: 59 },
} as const;
/** Crédito do Simples de exemplo: 2,82% de 21,00 = 0,59. */
const CREDITO_SN_DE_TESTE = { pCredSN: '2.82', vCredICMSSN: 59 } as const;

/** Um ICMS de exemplo por CSOSN do XSD (101, 102, 103, 201, 202, 203, 300, 400, 500 e 900). */
export const ICMS_POR_CSOSN = {
  '101': { CSOSN: '101', orig: 0, ...CREDITO_SN_DE_TESTE },
  '102': { CSOSN: '102', orig: 0 },
  '103': { CSOSN: '103', orig: 0 },
  '201': { CSOSN: '201', orig: 0, ...ST_DE_TESTE, ...CREDITO_SN_DE_TESTE },
  '202': { CSOSN: '202', orig: 0, ...ST_DE_TESTE },
  '203': { CSOSN: '203', orig: 0, ...ST_DE_TESTE },
  '300': { CSOSN: '300', orig: 0 },
  '400': { CSOSN: '400', orig: 0 },
  '500': {
    CSOSN: '500',
    orig: 0,
    STRet: { vBCSTRet: 2940, pST: '20', vICMSSubstituto: 420, vICMSSTRet: 168 },
    FCPSTRet: { vBCFCPSTRet: 2940, pFCPSTRet: '2', vFCPSTRet: 59 },
  },
  '900': {
    CSOSN: '900',
    orig: 0,
    proprio: { modBC: 3, vBC: 2100, pICMS: '20', vICMS: 420 },
    ST: ST_DE_TESTE,
    credito: CREDITO_SN_DE_TESTE,
  },
} as const satisfies Record<string, Icms>;
export type CsosnDeTeste = keyof typeof ICMS_POR_CSOSN;

/** Item do Simples (2 × 10,50 = 21,00) com o ICMS dado e PIS/COFINS 99 zerados, sem IBS/CBS. */
export function itemSimples(n: number, icms: Icms): Item {
  return {
    cProd: `S${String(n).padStart(4, '0')}`,
    xProd: `PRODUTO DO SIMPLES ${n}`,
    NCM: '22021000',
    CFOP: '5102',
    uCom: 'UN',
    qCom: '2',
    vUnCom: '10.5',
    vProd: 2100,
    imposto: { ICMS: icms, PIS: PIS_COFINS_99_ZERADO, COFINS: PIS_COFINS_99_ZERADO },
  };
}

/** vNF esperado do item do Simples: vProd + vICMSST + vFCPST (201, 202/203 e 900). */
function vNfSimples(itens: Item[]): number {
  return itens.reduce((s, it) => {
    const icms = it.imposto.ICMS as { ST?: typeof ST_DE_TESTE; vICMSST?: number };
    const st = icms.ST ?? (icms.vICMSST !== undefined ? ST_DE_TESTE : undefined);
    return s + it.vProd + (st ? st.vICMSST + st.FCPST.vFCPST : 0);
  }, 0);
}

/** Nota do Simples com o CRT dado (1 = Simples, 4 = MEI). */
export function notaSimples(itens: Item[], CRT: 1 | 4 = 1): NotaParaEmissaoEntrada {
  return { ...BASE, emit: { ...BASE.emit, CRT }, itens, pag: { detPag: [{ indPag: 0, tPag: '01', vPag: vNfSimples(itens) }] } };
}

/** Uma nota por CSOSN (CRT 1). */
export const NOTAS_POR_CSOSN = Object.fromEntries(
  Object.entries(ICMS_POR_CSOSN).map(([csosn, icms]) => [csosn, notaSimples([itemSimples(1, icms)])]),
) as Record<CsosnDeTeste, NotaParaEmissaoEntrada>;

/**
 * Nota do MEI (piloto, CRT 4, NT 2024.001): item com CSOSN 102 e item com CSOSN 500 (mercadoria com ST retido),
 * PIS e COFINS 99 zerados, sem o grupo IBS/CBS (Simples só a partir de 2027, "a conferir" na T-0046).
 */
export const notaMei = notaSimples([itemSimples(1, ICMS_POR_CSOSN['102']), itemSimples(2, ICMS_POR_CSOSN['500'])], 4);
