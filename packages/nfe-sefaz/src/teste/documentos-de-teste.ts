/**
 * Documentos SÓ DE TESTE, sem assinatura, no leiaute 4.00 / PL_010g: uma NF-e mínima (um item, com os grupos IBS e
 * CBS da NT 2025.002-RTC e, se pedido, o IS), o evento de cancelamento, a CC-e e a inutilização. Montagem de teste:
 * a montagem de produção é da T-0018/T-0021. Os textos de homologação são o `XNOME_HOMOLOGACAO` (RD-0254).
 */
import { CUF, C_ORGAO_AN, TP_AMB, TP_EMIS, XNOME_HOMOLOGACAO, type ModoEmissao, type TpEmis } from '../ambiente';
import { montarChaveNFe } from '../chave';
import { aammSefaz, dataHoraSefaz } from '../datas';
import { dadosEpecDaNFe, type DadosEpec } from '../epec';
import { DESC_EVENTO, X_COND_USO_CCE, idEvento, idInutilizacao } from '../eventos';
import { TIPO_EVENTO, type TipoEvento } from '../porta';
import { NS_NFE } from '../xmldsig';
import { CNPJ_EMITENTE_DE_TESTE, CNPJ_OUTRO_DE_TESTE } from './a1-de-teste';

export interface OpcoesNFeDeTeste {
  nNF: number;
  serie?: number;
  cnpj?: string;
  /** Instante da emissão (UTC); vai no XML em −04:00. */
  dhEmi: Date;
  /** 8 dígitos; padrão: derivado do número (determinístico). */
  cNF?: string;
  modo?: ModoEmissao;
  /** `tpEmis` do XML e da chave (padrão: o do `modo`). 4 = EPEC. */
  tpEmis?: TpEmis;
  /**
   * `dhCont` e `xJust` da contingência. Padrão: presentes quando o `tpEmis` não é 1 (`dhCont` = `dhEmi`). `null`
   * tira os dois (para forjar o 557); com `tpEmis` 1, informar os dois forja o 556.
   */
  contingencia?: { dhCont: Date; xJust?: string } | null;
  /** Para forjar o 252: 1 = produção. Padrão 2. */
  tpAmb?: 1 | 2;
  /** Para forjar o 226. Padrão 13 (AM). */
  cUF?: number;
  /** CPF ou CNPJ do destinatário (padrão: `CNPJ_OUTRO_DE_TESTE`). */
  docDestinatario?: string;
  /** Inclui o grupo do Imposto Seletivo (IS) no item e no total. */
  comIS?: boolean;
  /** Valor do item em centavos (padrão 1000). */
  valorCentavos?: number;
}

export interface NFeDeTeste {
  readonly chave: string;
  /** `<NFe>` sem assinatura. */
  readonly xml: string;
}

const reais = (c: number) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;

export function montarNFeDeTeste(o: OpcoesNFeDeTeste): NFeDeTeste {
  const cnpj = o.cnpj ?? CNPJ_EMITENTE_DE_TESTE;
  const serie = o.serie ?? 1;
  const modo = o.modo ?? 'normal';
  const tpEmis = o.tpEmis ?? TP_EMIS[modo];
  const cUF = o.cUF ?? CUF.AM;
  const tpAmb = o.tpAmb ?? TP_AMB.homologacao;
  const cNF = o.cNF ?? String((o.nNF * 7919 + 13) % 100_000_000).padStart(8, '0');
  const dhEmi = dataHoraSefaz(o.dhEmi);
  const chave = montarChaveNFe({ cUF, aamm: aammSefaz(dhEmi), cnpj, mod: '55', serie, nNF: o.nNF, tpEmis, cNF });
  const v = o.valorCentavos ?? 1000;
  // CBS 0,90% e IBS 0,10% (UF) + 0% (município): alíquotas de teste de 2026; arredondamento do Manual (meia para cima)
  const vCBS = Math.round((v * 90) / 10_000);
  const vIBSUF = Math.round((v * 10) / 10_000);
  const vIS = o.comIS ? Math.round((v * 200) / 10_000) : 0;
  const vICMS = Math.round((v * 2000) / 10_000);
  const doc = o.docDestinatario ?? CNPJ_OUTRO_DE_TESTE;
  const tagDoc = doc.length === 11 ? 'CPF' : 'CNPJ';
  const cont = o.contingencia === undefined ? (tpEmis === 1 ? null : { dhCont: o.dhEmi }) : o.contingencia;
  const contingencia = cont
    ? `<dhCont>${dataHoraSefaz(cont.dhCont)}</dhCont><xJust>${cont.xJust ?? 'SEFAZ-AM indisponivel, emissao em contingencia (teste)'}</xJust>`
    : '';
  const endereco = (tag: string) =>
    `<${tag}><xLgr>Rua de Teste</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>1302603</cMun><xMun>Manaus</xMun><UF>AM</UF><CEP>69005000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></${tag}>`;
  const is = o.comIS ? `<IS><CSTIS>000</CSTIS><cClassTribIS>000001</cClassTribIS><vBCIS>${reais(v)}</vBCIS><pIS>2.00</pIS><vIS>${reais(vIS)}</vIS></IS>` : '';
  const isTot = o.comIS ? `<ISTot><vIS>${reais(vIS)}</vIS></ISTot>` : '';

  const xml =
    `<NFe xmlns="${NS_NFE}"><infNFe versao="4.00" Id="NFe${chave}">` +
    `<ide><cUF>${cUF}</cUF><cNF>${cNF}</cNF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>${serie}</serie>` +
    `<nNF>${o.nNF}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>1302603</cMunFG><tpImp>1</tpImp>` +
    `<tpEmis>${tpEmis}</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal>` +
    `<indPres>1</indPres><procEmi>0</procEmi><verProc>MACUXI-TESTE-0.1</verProc>${contingencia}</ide>` +
    `<emit><CNPJ>${cnpj}</CNPJ><xNome>EMPRESA FICTICIA DE TESTE LTDA</xNome>${endereco('enderEmit')}<IE>062000012</IE><CRT>3</CRT></emit>` +
    `<dest><${tagDoc}>${doc}</${tagDoc}><xNome>${XNOME_HOMOLOGACAO}</xNome>${endereco('enderDest')}<indIEDest>9</indIEDest></dest>` +
    `<det nItem="1"><prod><cProd>0001</cProd><cEAN>SEM GTIN</cEAN><xProd>${XNOME_HOMOLOGACAO}</xProd><NCM>22021000</NCM>` +
    `<CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${reais(v)}</vUnCom><vProd>${reais(v)}</vProd>` +
    `<cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>${reais(v)}</vUnTrib><indTot>1</indTot></prod>` +
    `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${reais(v)}</vBC><pICMS>20.00</pICMS><vICMS>${reais(vICMS)}</vICMS></ICMS00></ICMS>` +
    `<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>${is}` +
    `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${reais(v)}</vBC>` +
    `<gIBSUF><pIBSUF>0.10</pIBSUF><vIBSUF>${reais(vIBSUF)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.00</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>` +
    `<vIBS>${reais(vIBSUF)}</vIBS><gCBS><pCBS>0.90</pCBS><vCBS>${reais(vCBS)}</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>` +
    `<total><ICMSTot><vBC>${reais(v)}</vBC><vICMS>${reais(vICMS)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${reais(v)}</vProd><vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS>` +
    `<vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${reais(v)}</vNF></ICMSTot>${isTot}` +
    `<IBSCBSTot><vBCIBSCBS>${reais(v)}</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${reais(vIBSUF)}</vIBSUF></gIBSUF>` +
    `<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${reais(vIBSUF)}</vIBS><vCredPres>0.00</vCredPres>` +
    `<vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${reais(vCBS)}</vCBS>` +
    `<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot></total>` +
    `<transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>${reais(v)}</vPag></detPag></pag>` +
    `</infNFe></NFe>`;
  return { chave, xml };
}

export interface OpcoesEventoDeTeste {
  chave: string;
  dhEvento: Date;
  cnpj?: string;
  tpAmb?: 1 | 2;
  cOrgao?: number;
}

function evento(o: OpcoesEventoDeTeste, tpEvento: TipoEvento, nSeq: number, detalhe: string): string {
  const id = idEvento(tpEvento, o.chave, nSeq);
  return (
    `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}"><cOrgao>${o.cOrgao ?? CUF.AM}</cOrgao><tpAmb>${o.tpAmb ?? 2}</tpAmb>` +
    `<CNPJ>${o.cnpj ?? CNPJ_EMITENTE_DE_TESTE}</CNPJ><chNFe>${o.chave}</chNFe><dhEvento>${dataHoraSefaz(o.dhEvento)}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${detalhe}</detEvento></infEvento></evento>`
  );
}

/** `<evento>` 110111 sem assinatura. */
export function montarCancelamentoDeTeste(o: OpcoesEventoDeTeste & { nProt: string; xJust?: string }): string {
  const xJust = o.xJust ?? 'Cancelamento de teste no simulador da SEFAZ';
  return evento(o, TIPO_EVENTO.cancelamento, 1, `<descEvento>${DESC_EVENTO[TIPO_EVENTO.cancelamento]}</descEvento><nProt>${o.nProt}</nProt><xJust>${xJust}</xJust>`);
}

/** `<evento>` 110110 (CC-e) sem assinatura. */
export function montarCartaCorrecaoDeTeste(o: OpcoesEventoDeTeste & { nSeqEvento: number; xCorrecao?: string }): string {
  const x = o.xCorrecao ?? 'Correcao de teste: o endereco de entrega e Rua de Teste, 100';
  return evento(o, TIPO_EVENTO.cartaCorrecao, o.nSeqEvento, `<descEvento>${DESC_EVENTO[TIPO_EVENTO.cartaCorrecao]}</descEvento><xCorrecao>${x}</xCorrecao><xCondUso>${X_COND_USO_CCE}</xCondUso>`);
}

/**
 * `<evento>` 110140 (EPEC) sem assinatura, com o resumo tirado da NF-e de teste (`dadosEpecDaNFe`): o `cOrgao` é o do
 * Ambiente Nacional (91). `ajustar` mexe nos dados antes de montar (para forjar o 467 na volta).
 */
export function montarEpecDeTeste(
  nfeXml: string,
  o: Omit<OpcoesEventoDeTeste, 'chave'> & { ajustar?: (d: DadosEpec) => DadosEpec },
): string {
  const lido = dadosEpecDaNFe(nfeXml);
  if (!lido) throw new Error('montarEpecDeTeste: NF-e de teste ilegível');
  const d = o.ajustar ? o.ajustar(lido) : lido;
  const doc = `<${d.dest.documento.tag}>${d.dest.documento.valor}</${d.dest.documento.tag}>`;
  return evento(
    { ...o, chave: d.chNFe, cOrgao: o.cOrgao ?? C_ORGAO_AN, cnpj: o.cnpj ?? d.cnpj },
    TIPO_EVENTO.epec,
    1,
    `<descEvento>${DESC_EVENTO[TIPO_EVENTO.epec]}</descEvento><cOrgaoAutor>${d.cOrgaoAutor}</cOrgaoAutor><tpAutor>1</tpAutor>` +
      `<verAplic>${d.verAplic}</verAplic><dhEmi>${d.dhEmi}</dhEmi><tpNF>${d.tpNF}</tpNF><IE>${d.IE}</IE>` +
      `<dest><UF>${d.dest.UF}</UF>${doc}${d.dest.IE ? `<IE>${d.dest.IE}</IE>` : ''}<vNF>${d.vNF}</vNF><vICMS>${d.vICMS}</vICMS><vST>${d.vST}</vST></dest>`,
  );
}

/** `<inutNFe>` sem assinatura. `ano` com 2 dígitos. */
export function montarInutilizacaoDeTeste(o: {
  ano: string;
  serie?: number;
  nNFIni: number;
  nNFFin: number;
  cnpj?: string;
  tpAmb?: 1 | 2;
  cUF?: number;
  xJust?: string;
}): string {
  const cnpj = o.cnpj ?? CNPJ_EMITENTE_DE_TESTE;
  const serie = o.serie ?? 1;
  const cUF = o.cUF ?? CUF.AM;
  const id = idInutilizacao({ cUF, ano: o.ano, cnpj, serie, nNFIni: o.nNFIni, nNFFin: o.nNFFin });
  return (
    `<inutNFe xmlns="${NS_NFE}" versao="4.00"><infInut Id="${id}"><tpAmb>${o.tpAmb ?? 2}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${cUF}</cUF>` +
    `<ano>${o.ano}</ano><CNPJ>${cnpj}</CNPJ><mod>55</mod><serie>${serie}</serie><nNFIni>${o.nNFIni}</nNFIni><nNFFin>${o.nNFFin}</nNFFin>` +
    `<xJust>${o.xJust ?? 'Inutilizacao de teste no simulador da SEFAZ'}</xJust></infInut></inutNFe>`
  );
}
