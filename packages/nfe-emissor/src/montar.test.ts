import { XNOME_HOMOLOGACAO, chaveNFeComDvValido as chaveValida } from '@macuxierp/nfe-sefaz';
import { describe, expect, it } from 'vitest';
import { NotaParaEmissao } from './entrada';
import type { NotaParaEmissaoEntrada } from './entrada';
import { conferirValores, ErroMontagemNFe, montarNFe } from './montar';
import {
  ICMS_POR_CSOSN,
  NOTAS,
  NOTAS_POR_CSOSN,
  PIS_COFINS_99_ZERADO,
  itemSimples,
  itemTributado,
  nota50Itens,
  notaComDescontoEFrete,
  notaComIs,
  notaMei,
  notaSimples,
  vendaInterestadual,
  vendaSimplesAm,
} from './testes/notas';

type ItemEntrada = NotaParaEmissaoEntrada['itens'][number];

const tag = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'g'))].map((m) => m[1]);
const grupoXml = (xml: string, nome: string) => new RegExp(`<${nome}>[\\s\\S]*?</${nome}>`).exec(xml)?.[0] ?? '';

describe('montagem do XML da NF-e 55, leiaute 4.00', () => {
  it('raiz, Id, versão e forma canônica (sem declaração, sem tag vazia abreviada)', () => {
    const r = montarNFe(vendaSimplesAm);
    expect(r.xml.startsWith(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${r.chave}" versao="4.00"><ide>`)).toBe(true);
    expect(r.xml.endsWith('</infNFe></NFe>')).toBe(true);
    expect(r.xml).not.toMatch(/\/>|<\?xml|>\s+</);
    expect(chaveValida(r.chave)).toBe(true);
    expect(r.chave.slice(2, 6)).toBe('2611'); // AAMM no fuso de Manaus (UTC 22/11 02:59 = 21/11 22:59)
    expect(r.cNF).toBe('48213705');
  });

  it('ide na ordem do leiaute, dhEmi com o deslocamento da filial', () => {
    const r = montarNFe(vendaSimplesAm);
    const ide = grupoXml(r.xml, 'ide');
    const ordem = [...ide.matchAll(/<(\w+)>/g)].map((m) => m[1]).slice(1);
    expect(ordem).toEqual(['cUF', 'cNF', 'natOp', 'mod', 'serie', 'nNF', 'dhEmi', 'tpNF', 'idDest', 'cMunFG', 'tpImp', 'tpEmis', 'cDV', 'tpAmb', 'finNFe', 'indFinal', 'indPres', 'procEmi', 'verProc']);
    expect(tag(r.xml, 'dhEmi')).toEqual(['2026-11-21T22:59:00-04:00']);
    expect(tag(r.xml, 'cDV')).toEqual([r.chave.slice(43)]);
  });

  it('homologação troca o nome do destinatário (RN-FAT-04: sem valor fiscal)', () => {
    expect(tag(grupoXml(montarNFe(vendaSimplesAm).xml, 'dest'), 'xNome')).toEqual([XNOME_HOMOLOGACAO]);
    const producao = montarNFe({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, tpAmb: 1 } });
    expect(tag(grupoXml(producao.xml, 'dest'), 'xNome')).toEqual(['CLIENTE FICTICIO LTDA']);
  });

  it('item com ICMS 00, PIS/COFINS alíquota e o grupo IBSCBS da NT 2025.002-RTC', () => {
    const xml = montarNFe(vendaSimplesAm).xml;
    expect(xml).toContain('<det nItem="1"><prod><cProd>P0001</cProd><cEAN>SEM GTIN</cEAN>');
    expect(xml).toContain('<qCom>2.0000</qCom><vUnCom>10.5000000000</vUnCom><vProd>21.00</vProd>');
    expect(xml).toContain('<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>21.00</vBC><pICMS>20.0000</pICMS><vICMS>4.20</vICMS></ICMS00></ICMS>');
    expect(xml).toContain('<PIS><PISAliq><CST>01</CST><vBC>21.00</vBC><pPIS>1.6500</pPIS><vPIS>0.35</vPIS></PISAliq></PIS>');
    expect(xml).toContain(
      '<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>21.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.02</vIBSUF></gIBSUF>' +
        '<gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.02</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.19</vCBS></gCBS></gIBSCBS></IBSCBS>',
    );
  });

  it('totais calculados dos itens, com IBSCBSTot', () => {
    const xml = montarNFe(vendaSimplesAm).xml;
    const tot = grupoXml(xml, 'ICMSTot');
    expect(tag(tot, 'vProd')).toEqual(['21.00']);
    expect(tag(tot, 'vICMS')).toEqual(['4.20']);
    expect(tag(tot, 'vNF')).toEqual(['21.00']);
    expect(grupoXml(xml, 'IBSCBSTot')).toBe(
      '<IBSCBSTot><vBCIBSCBS>21.00</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>0.02</vIBSUF></gIBSUF>' +
        '<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.02</vIBS><vCredPres>0.00</vCredPres>' +
        '<vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>0.19</vCBS><vCredPres>0.00</vCredPres>' +
        '<vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot>',
    );
    expect(xml).not.toContain('<ISTot>');
  });

  it('Imposto Seletivo no item e no ISTot', () => {
    const xml = montarNFe(notaComIs).xml;
    expect(xml).toContain('<IS><CSTIS>000</CSTIS><cClassTribIS>000001</cClassTribIS><vBCIS>51.00</vBCIS><pIS>2.0000</pIS><vIS>1.02</vIS></IS><IBSCBS>');
    expect(grupoXml(xml, 'ISTot')).toBe('<ISTot><vIS>1.02</vIS></ISTot>');
  });

  it('desconto e frete entram no item e no vNF (vProd - vDesc + vFrete)', () => {
    const xml = montarNFe(notaComDescontoEFrete).xml;
    expect(grupoXml(xml, 'prod')).toContain('<vProd>100.00</vProd><cEANTrib>');
    expect(grupoXml(xml, 'prod')).toContain('<vFrete>15.00</vFrete><vDesc>10.00</vDesc><indTot>1</indTot>');
    expect(tag(grupoXml(xml, 'ICMSTot'), 'vNF')).toEqual(['105.00']);
  });

  it('vItem e vNFTot (NT 2025.002-RTC): em 2026 sem IS/IBS/CBS; a partir de 2027 com eles', () => {
    const x2026 = montarNFe(notaComIs).xml;
    expect(tag(x2026, 'vItem')).toEqual(['51.00']);
    expect(tag(x2026, 'vNFTot')).toEqual(['51.00']);
    expect(x2026).toMatch(/<\/IBSCBSTot><vNFTot>51\.00<\/vNFTot><\/total>/);
    const x2027 = montarNFe({ ...notaComIs, ide: { ...notaComIs.ide, dhEmi: '2027-01-04T13:00:00Z' } }).xml;
    // 51,00 + IS 1,02 + IBS UF 0,05 + CBS 0,46
    expect(tag(x2027, 'vItem')).toEqual(['52.53']);
    expect(tag(x2027, 'vNFTot')).toEqual(['52.53']);
    expect(tag(montarNFe(notaComDescontoEFrete).xml, 'vItem')).toEqual(['105.00']);
  });

  it('interestadual e 50 itens', () => {
    expect(tag(montarNFe(vendaInterestadual).xml, 'idDest')).toEqual(['2']);
    const xml = montarNFe(nota50Itens).xml;
    expect(xml.match(/<det nItem=/g)).toHaveLength(50);
    expect(xml).toContain('<det nItem="50">');
  });

  it('pagamento tPag 99 leva o xPag (entre tPag e vPag); sem ele, a entrada é recusada', () => {
    const pag = (xPag?: string) => ({ ...vendaSimplesAm, pag: { detPag: [{ indPag: 0 as const, tPag: '99', ...(xPag ? { xPag } : {}), vPag: 2100 }] } });
    expect(grupoXml(montarNFe(pag('Conforme condicao combinada')).xml, 'detPag')).toBe(
      '<detPag><indPag>0</indPag><tPag>99</tPag><xPag>Conforme condicao combinada</xPag><vPag>21.00</vPag></detPag>',
    );
    expect(() => montarNFe(pag())).toThrow(/pag\.detPag\.0\.xPag: tPag 99 exige xPag/);
  });

  it('texto com & e < sai escapado', () => {
    const r = montarNFe({ ...vendaSimplesAm, infAdic: { infCpl: 'PEDIDO A&B <123>' } });
    expect(r.xml).toContain('<infAdic><infCpl>PEDIDO A&amp;B &lt;123&gt;</infCpl></infAdic>');
  });

  it('sorteia o cNF quando não vem e a chave segue válida', () => {
    const { cNF: _sem, ...ide } = vendaSimplesAm.ide;
    const r = montarNFe({ ...vendaSimplesAm, ide }, { aleatorio: () => 31415926 });
    expect(r.cNF).toBe('31415926');
    expect(r.chave.slice(35, 43)).toBe('31415926');
  });

  it('recusa entrada inválida citando só o caminho', () => {
    const ruim = { ...vendaSimplesAm, emit: { ...vendaSimplesAm.emit, CNPJ: '123' } };
    expect(() => montarNFe(ruim)).toThrow(ErroMontagemNFe);
    try {
      montarNFe(ruim);
    } catch (e) {
      expect((e as ErroMontagemNFe).codigo).toBe('NFE_ENTRADA_INVALIDA');
      expect((e as ErroMontagemNFe).ocorrencias.join()).toMatch(/^emit\.CNPJ/);
    }
  });

  it('confere vProd e tributos com a tolerância de R$ 0,01', () => {
    const item = itemTributado(1);
    expect(() => montarNFe({ ...vendaSimplesAm, itens: [{ ...item, vProd: item.vProd + 2 }] })).toThrow(/NFE_VALOR_DIVERGENTE: itens\[0\]\.vProd/);
    expect(() => montarNFe({ ...vendaSimplesAm, itens: [{ ...item, vProd: item.vProd + 1 }] })).not.toThrow();
    const icms = { ...item.imposto.ICMS, vICMS: 422 };
    expect(() => montarNFe({ ...vendaSimplesAm, itens: [{ ...item, imposto: { ...item.imposto, ICMS: icms } }] })).toThrow(/itens\[0\]\.imposto\.ICMS\.vICMS/);
  });

  it('todas as fixtures montam', () => {
    for (const n of Object.values(NOTAS)) expect(chaveValida(montarNFe(n).chave)).toBe(true);
  });

  it('RN-CAD-02: IE com DV errado no AM (emitente) ou no PA (destinatário) é recusada', () => {
    const emit = { ...vendaSimplesAm, emit: { ...vendaSimplesAm.emit, IE: '041234562' } };
    expect(() => montarNFe(emit)).toThrow(/NFE_ENTRADA_INVALIDA: emit\.IE: RN-CAD-02/);
    const dest = { ...vendaInterestadual, dest: { ...vendaInterestadual.dest!, IE: '151234565' } };
    expect(() => montarNFe(dest)).toThrow(/dest\.IE: RN-CAD-02/);
  });
});

describe('arredondamento por tributo no empate exato (RN-CORE-03 e RN-FIS-03)', () => {
  // vProd R$ 0,50 e alíquota de 1%: todo tributo dá 0,5 centavo, o empate exato.
  const empate = (v: { vICMS: number; vPIS: number; vIS: number; vRtc: number }) => {
    const base = itemTributado(1, '1', '0.5');
    return {
      ...vendaSimplesAm,
      itens: [
        {
          ...base,
          imposto: {
            ICMS: { CST: '00', orig: 0, modBC: 3, vBC: 50, pICMS: '1', vICMS: v.vICMS },
            PIS: { CST: '01', vBC: 50, aliquota: '1', valor: v.vPIS },
            COFINS: { CST: '01', vBC: 50, aliquota: '1', valor: v.vPIS },
            IS: { CSTIS: '000', cClassTribIS: '000001', vBCIS: 50, pIS: '1', vIS: v.vIS },
            IBSCBS: { CST: '000', cClassTrib: '000001', gIBSCBS: { vBC: 50, pIBSUF: '1', vIBSUF: v.vRtc, pIBSMun: '1', vIBSMun: v.vRtc, pCBS: '1', vCBS: v.vRtc } },
          },
        },
      ],
      pag: { detPag: [{ indPag: 0, tPag: '01', vPag: 50 }] },
    } as typeof vendaSimplesAm;
  };
  const exato = { toleranciaCentavos: 0 };

  it('padrão: ICMS, PIS e COFINS meio para cima (0,5 → 1); IBS, CBS e IS meio-para-par (0,5 → 0)', () => {
    expect(() => montarNFe(empate({ vICMS: 1, vPIS: 1, vIS: 0, vRtc: 0 }), exato)).not.toThrow();
    expect(() => montarNFe(empate({ vICMS: 0, vPIS: 1, vIS: 0, vRtc: 0 }), exato)).toThrow(/ICMS\.vICMS/);
    expect(() => montarNFe(empate({ vICMS: 1, vPIS: 0, vIS: 0, vRtc: 0 }), exato)).toThrow(/PIS\.valor/);
    expect(() => montarNFe(empate({ vICMS: 1, vPIS: 1, vIS: 1, vRtc: 1 }), exato)).toThrow(/IS\.vIS.*IBSCBS\.vIBSUF.*IBSCBS\.vIBSMun.*IBSCBS\.vCBS/);
  });

  it('comparação: a conferência com meio para cima em IBS, CBS e IS faria o empate subir (não é opção da montagem)', () => {
    const conferir = (v: Parameters<typeof empate>[0]) => conferirValores(NotaParaEmissao.parse(empate(v)), 0, 'meio-para-cima');
    expect(conferir({ vICMS: 1, vPIS: 1, vIS: 1, vRtc: 1 })).toEqual([]);
    expect(conferir({ vICMS: 1, vPIS: 1, vIS: 0, vRtc: 0 }).join()).toMatch(/IS\.vIS/);
    expect(conferirValores(NotaParaEmissao.parse(empate({ vICMS: 1, vPIS: 1, vIS: 0, vRtc: 0 })), 0)).toEqual([]);
  });
});

describe('Simples Nacional: um grupo ICMSSN por CSOSN, na ordem do XSD do PL_010g', () => {
  const icmsDe = (csosn: keyof typeof NOTAS_POR_CSOSN) => grupoXml(montarNFe(NOTAS_POR_CSOSN[csosn]).xml, 'ICMS');
  const ST = '<modBCST>4</modBCST><pMVAST>40.0000</pMVAST><vBCST>29.40</vBCST><pICMSST>20.0000</pICMSST><vICMSST>1.68</vICMSST>' +
    '<vBCFCPST>29.40</vBCFCPST><pFCPST>2.0000</pFCPST><vFCPST>0.59</vFCPST>';
  const CRED = '<pCredSN>2.8200</pCredSN><vCredICMSSN>0.59</vCredICMSSN>';

  it('101 vai no ICMSSN101 com pCredSN e vCredICMSSN (o defeito era o grupo ICMSSN${CSOSN})', () => {
    expect(icmsDe('101')).toBe(`<ICMS><ICMSSN101><orig>0</orig><CSOSN>101</CSOSN>${CRED}</ICMSSN101></ICMS>`);
  });

  it('102, 103, 300 e 400 vão todos no ICMSSN102 (não existe ICMSSN103/300/400)', () => {
    for (const c of ['102', '103', '300', '400'] as const) {
      expect(icmsDe(c), c).toBe(`<ICMS><ICMSSN102><orig>0</orig><CSOSN>${c}</CSOSN></ICMSSN102></ICMS>`);
    }
  });

  it('201 vai no ICMSSN201: ST, FCP-ST e crédito, nessa ordem', () => {
    expect(icmsDe('201')).toBe(`<ICMS><ICMSSN201><orig>0</orig><CSOSN>201</CSOSN>${ST}${CRED}</ICMSSN201></ICMS>`);
  });

  it('202 e 203 vão no ICMSSN202: ST e FCP-ST, sem crédito', () => {
    for (const c of ['202', '203'] as const) expect(icmsDe(c), c).toBe(`<ICMS><ICMSSN202><orig>0</orig><CSOSN>${c}</CSOSN>${ST}</ICMSSN202></ICMS>`);
  });

  it('500 vai no ICMSSN500: ST retido (com vICMSSubstituto) e FCP retido; sem eles, só orig e CSOSN', () => {
    expect(icmsDe('500')).toBe(
      '<ICMS><ICMSSN500><orig>0</orig><CSOSN>500</CSOSN><vBCSTRet>29.40</vBCSTRet><pST>20.0000</pST><vICMSSubstituto>4.20</vICMSSubstituto>' +
        '<vICMSSTRet>1.68</vICMSSTRet><vBCFCPSTRet>29.40</vBCFCPSTRet><pFCPSTRet>2.0000</pFCPSTRet><vFCPSTRet>0.59</vFCPSTRet></ICMSSN500></ICMS>',
    );
    const so = montarNFe(notaSimples([itemSimples(1, { CSOSN: '500', orig: 0 })])).xml;
    expect(grupoXml(so, 'ICMS')).toBe('<ICMS><ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS>');
  });

  it('900 vai no ICMSSN900: ICMS próprio, ST e crédito, todos opcionais', () => {
    expect(icmsDe('900')).toBe(
      `<ICMS><ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>3</modBC><vBC>21.00</vBC><pICMS>20.0000</pICMS><vICMS>4.20</vICMS>${ST}${CRED}</ICMSSN900></ICMS>`,
    );
    const minimo = montarNFe(notaSimples([itemSimples(1, { CSOSN: '900', orig: 0 })])).xml;
    expect(grupoXml(minimo, 'ICMS')).toBe('<ICMS><ICMSSN900><orig>0</orig><CSOSN>900</CSOSN></ICMSSN900></ICMS>');
  });

  it('totais: vBC/vICMS 0 no Simples, exceto o 900 com ICMS próprio; vBCST, vST e vFCPST do 201/202/900 (no vNF e no vItem); vFCPSTRet do 500', () => {
    const tot = (xml: string, t: string) => tag(grupoXml(xml, 'ICMSTot'), t)[0];
    for (const c of ['101', '102', '500'] as const) {
      const xml = montarNFe(NOTAS_POR_CSOSN[c]).xml;
      expect([tot(xml, 'vBC'), tot(xml, 'vICMS'), tot(xml, 'vBCST'), tot(xml, 'vST'), tot(xml, 'vFCPST'), tot(xml, 'vNF')], c).toEqual(['0.00', '0.00', '0.00', '0.00', '0.00', '21.00']);
    }
    expect(tot(montarNFe(NOTAS_POR_CSOSN['500']).xml, 'vFCPSTRet')).toBe('0.59');
    for (const c of ['201', '202', '203'] as const) {
      const xml = montarNFe(NOTAS_POR_CSOSN[c]).xml;
      expect([tot(xml, 'vICMS'), tot(xml, 'vBCST'), tot(xml, 'vST'), tot(xml, 'vFCPST'), tot(xml, 'vNF'), tag(xml, 'vItem')[0]], c).toEqual(['0.00', '29.40', '1.68', '0.59', '23.27', '23.27']);
    }
    const x900 = montarNFe(NOTAS_POR_CSOSN['900']).xml;
    expect([tot(x900, 'vBC'), tot(x900, 'vICMS'), tot(x900, 'vST'), tot(x900, 'vNF'), tag(x900, 'vNFTot')[0]]).toEqual(['21.00', '4.20', '1.68', '23.27', '23.27']);
    // Duas notas somadas: 201 + 900 + 500 no mesmo documento.
    const varios = montarNFe(notaSimples([itemSimples(1, ICMS_POR_CSOSN['201']), itemSimples(2, ICMS_POR_CSOSN['900']), itemSimples(3, ICMS_POR_CSOSN['500'])])).xml;
    expect([tot(varios, 'vBCST'), tot(varios, 'vST'), tot(varios, 'vFCPST'), tot(varios, 'vFCPSTRet'), tot(varios, 'vICMS'), tot(varios, 'vNF')]).toEqual(['58.80', '3.36', '1.18', '0.59', '4.20', '67.54']);
  });

  it('900: o vICMS próprio é conferido como no ICMS 00 (meio para cima, tolerância de R$ 0,01)', () => {
    const icms = { ...ICMS_POR_CSOSN['900'], proprio: { ...ICMS_POR_CSOSN['900'].proprio, vICMS: 422 } };
    expect(() => montarNFe(notaSimples([itemSimples(1, icms)]))).toThrow(/itens\[0\]\.imposto\.ICMS\.proprio\.vICMS/);
  });

  it('entrada: cada CSOSN exige os campos do seu grupo e só aceita CSOSN do XSD', () => {
    const recusa = (icms: unknown, padrao: RegExp) =>
      expect(() => montarNFe(notaSimples([itemSimples(1, icms as typeof ICMS_POR_CSOSN['102'])]))).toThrow(padrao);
    recusa({ CSOSN: '101', orig: 0 }, /ICMS\.pCredSN/);
    recusa({ ...ICMS_POR_CSOSN['101'], CSOSN: '201' }, /ICMS\.vBCST/);
    recusa({ ...ICMS_POR_CSOSN['202'], vBCST: undefined }, /ICMS\.vBCST/);
    recusa({ CSOSN: '500', orig: 0, STRet: { vBCSTRet: 1 } }, /ICMS\.STRet\.pST/);
    recusa({ CSOSN: '999', orig: 0 }, /NFE_ENTRADA_INVALIDA: itens\.0\.imposto\.ICMS/);
    recusa({ ...ICMS_POR_CSOSN['101'], vCredICMSSN: 5.5 }, /vCredICMSSN/);
  });
});

describe('PIS e COFINS: PISOutr/COFINSOutr (CST 49 a 99), aceitando zero', () => {
  it('MEI: CST 99 zerado vai no PISOutr/COFINSOutr com vBC, alíquota e valor 0 (o XSD exige a base)', () => {
    const xml = montarNFe(notaMei).xml;
    expect(xml).toContain('<PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>');
    expect(xml).toContain('<COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>');
    expect(tag(xml, 'CRT')).toEqual(['4']);
    expect(xml).not.toContain('<IBSCBS>');
  });

  it('CST 49 com base em % e CST 98 por quantidade (qBCProd × vAliqProd), com o valor conferido', () => {
    const it49: ItemEntrada = {
      ...itemSimples(1, ICMS_POR_CSOSN['102']),
      imposto: { ICMS: ICMS_POR_CSOSN['102'], PIS: { CST: '49', vBC: 2100, aliquota: '0.65', valor: 14 }, COFINS: { CST: '98', qBCProd: '2', vAliqProd: '0.1234', valor: 25 } },
    };
    const xml = montarNFe(notaSimples([it49])).xml;
    expect(xml).toContain('<PISOutr><CST>49</CST><vBC>21.00</vBC><pPIS>0.6500</pPIS><vPIS>0.14</vPIS></PISOutr>');
    expect(xml).toContain('<COFINSOutr><CST>98</CST><qBCProd>2.0000</qBCProd><vAliqProd>0.1234</vAliqProd><vCOFINS>0.25</vCOFINS></COFINSOutr>');
    expect([tag(grupoXml(xml, 'ICMSTot'), 'vPIS')[0], tag(grupoXml(xml, 'ICMSTot'), 'vCOFINS')[0]]).toEqual(['0.14', '0.25']);
    const errado: ItemEntrada = { ...it49, imposto: { ...it49.imposto, COFINS: { CST: '98', qBCProd: '2', vAliqProd: '0.1234', valor: 27 } } };
    expect(() => montarNFe(notaSimples([errado]))).toThrow(/itens\[0\]\.imposto\.COFINS\.valor/);
  });

  it('mantém os CST atuais (01/02 no Aliq, 04 a 09 no NT) e recusa CST fora do XSD', () => {
    const nt: ItemEntrada = { ...itemSimples(1, ICMS_POR_CSOSN['102']), imposto: { ICMS: ICMS_POR_CSOSN['102'], PIS: { CST: '07' }, COFINS: { CST: '07' } } };
    expect(montarNFe(notaSimples([nt])).xml).toContain('<PIS><PISNT><CST>07</CST></PISNT></PIS>');
    expect(montarNFe(vendaSimplesAm).xml).toContain('<PIS><PISAliq><CST>01</CST>');
    const ruim = { ...nt, imposto: { ...nt.imposto, PIS: { ...PIS_COFINS_99_ZERADO, CST: '10' } } };
    expect(() => montarNFe(notaSimples([ruim as unknown as ItemEntrada]))).toThrow(/itens\.0\.imposto\.PIS/);
  });
});
