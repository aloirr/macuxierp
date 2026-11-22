/** nfeProc de teste do DANFE (domain e api): mesma estrutura do emissor (grupos IDE, emit, dest, det, total, transp, cobr, infAdic) e protNFe. */
export const CHAVE_DANFE = '13261104641538000145550010000001231234567890';

export interface OpcoesNfeProc {
  itens?: number;
  tpAmb?: '1' | '2';
  tpNF?: '0' | '1';
  infCpl?: string;
  duplicatas?: boolean;
  semDestinatarioEndereco?: boolean;
  /** Transportador com placa, UF do veículo e volumes. */
  transportador?: boolean;
  /** Substitui no item 1: descrição, quantidade comercial (qCom) e valor do produto (vProd). */
  item1?: { descricao?: string; qCom?: string; vProd?: string; aliqIcms?: string };
  nomeDestinatario?: string;
}

export function nfeProcDeTeste(o: OpcoesNfeProc = {}): string {
  const n = o.itens ?? 2;
  const i1 = o.item1 ?? {};
  /** Valor do produto de cada item em centavos: o override do item 1 vale também para a BC do ICMS e o total (nota coerente). */
  const cent = (s: number) => (s === 1 && i1.vProd ? Math.round(Number(i1.vProd) * 100) : s * 1050);
  /** Alíquota do ICMS: 20% nos itens normais; 0% no item 1 com vProd substituído (valores de 13 inteiros: a tabela só cabe na folha sem quebrar NCM/UN com o ICMS zerado). */
  const aliq = (s: number) => (s === 1 && i1.aliqIcms ? i1.aliqIcms : s === 1 && i1.vProd ? '0' : '20');
  const vIcmsC = (s: number) => Math.round((cent(s) * Number(aliq(s))) / 100);
  const reais = (c: number) => (c / 100).toFixed(2);
  const det = Array.from({ length: n }, (_, i) => {
    const s = i + 1;
    return `<det nItem="${s}"><prod><cProd>P${s}</cProd><cEAN>SEM GTIN</cEAN><xProd>${s === 1 && i1.descricao ? i1.descricao : `Produto ${s} &amp; cia`}</xProd><NCM>22021000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>${s === 1 && i1.qCom ? i1.qCom : `${s}.0000`}</qCom><vUnCom>10.5000000000</vUnCom><vProd>${reais(cent(s))}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>${s}.0000</qTrib><vUnTrib>10.5000000000</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${reais(cent(s))}</vBC><pICMS>${aliq(s)}.0000</pICMS><vICMS>${reais(vIcmsC(s))}</vICMS></ICMS00></ICMS></imposto></det>`;
  }).join('');
  const vProdC = Array.from({ length: n }, (_, i) => cent(i + 1)).reduce((a, b) => a + b, 0);
  const vProd = reais(vProdC);
  const vBcTot = vProd;
  const vIcmsTot = reais(Array.from({ length: n }, (_, i) => vIcmsC(i + 1)).reduce((a, b) => a + b, 0));
  /** 2 parcelas derivadas do vNF: a primeira é a metade (piso) e a última absorve o centavo. */
  const p1 = Math.floor(vProdC / 2);
  const transp = o.transportador
    ? '<transp><modFrete>1</modFrete><transporta><CNPJ>11222333000181</CNPJ><xNome>TRANSPORTES RIO NEGRO LTDA</xNome><IE>041234561</IE><xEnder>Av. das Torres, 1500, Galpão 3</xEnder><xMun>Manaus</xMun><UF>AM</UF></transporta><veicTransp><placa>QZA1B23</placa><UF>AM</UF></veicTransp><vol><qVol>12</qVol><esp>CAIXA</esp><marca>MARCA TESTE</marca><nVol>1 a 12</nVol><pesoL>120.500</pesoL><pesoB>131.250</pesoB></vol></transp>'
    : '<transp><modFrete>9</modFrete></transp>';
  const dup = o.duplicatas ? `<cobr><dup><nDup>001</nDup><dVenc>2026-12-21</dVenc><vDup>${reais(p1)}</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-20</dVenc><vDup>${reais(vProdC - p1)}</vDup></dup></cobr>` : '';
  const ender = o.semDestinatarioEndereco ? '' : '<enderDest><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>1302603</cMun><xMun>Manaus</xMun><UF>AM</UF><CEP>69000000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderDest>';
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE_DANFE}" versao="4.00"><ide><cUF>13</cUF><cNF>23456789</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-11-21T10:00:00-04:00</dhEmi><tpNF>${o.tpNF ?? '1'}</tpNF><idDest>1</idDest><tpAmb>${o.tpAmb ?? '2'}</tpAmb></ide><emit><CNPJ>04641538000145</CNPJ><xNome>EMITENTE LTDA</xNome><enderEmit><xLgr>Rua E</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>1302603</cMun><xMun>Manaus</xMun><UF>AM</UF><CEP>69000000</CEP><fone>9233334444</fone></enderEmit><IE>041234561</IE><CRT>3</CRT></emit><dest><CNPJ>45723174000110</CNPJ><xNome>${o.nomeDestinatario ?? 'CLIENTE &amp; FILHOS'}</xNome>${ender}<indIEDest>1</indIEDest><IE>041234561</IE></dest>${det}<total><ICMSTot><vBC>${vBcTot}</vBC><vICMS>${vIcmsTot}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vProd}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${vProd}</vNF></ICMSTot></total>${transp}${dup}<pag><detPag><indPag>1</indPag><tPag>15</tPag><vPag>${vProd}</vPag></detPag></pag><infAdic><infCpl>${o.infCpl ?? 'Pedido 1'}</infCpl></infAdic></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFe><protNFe versao="4.00"><infProt><tpAmb>${o.tpAmb ?? '2'}</tpAmb><verAplic>SIMULADOR</verAplic><chNFe>${CHAVE_DANFE}</chNFe><dhRecbto>2026-11-21T10:31:02-04:00</dhRecbto><nProt>113260000000001</nProt><digVal>ZGln</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
}
