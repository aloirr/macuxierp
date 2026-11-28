/**
 * Grupo IPI (O01, TIpi do PL_010g, leiauteNFe_v4.00.xsd:7625) no item e o vIPI no ICMSTot, somado dos itens e no vNF
 * (W12 e W16). O cálculo é do modulo-fiscal (calc_ipi); o emissor confere a forma e o vIPI com o arredondamento do
 * Manual (meio para cima, RN-FIS-03 e adendo da ADR 0002) e monta.
 */
import { validarXsd } from '@macuxierp/nfe-sefaz';
import { describe, expect, it } from 'vitest';
import { criarEmissorNFe } from './emissor';
import type { NotaParaEmissaoEntrada } from './entrada';
import { ErroMontagemNFe, montarNFe } from './montar';
import { a1DeTesteAberto } from './testes/a1';
import { IPI_DE_TESTE, vendaComIpi as nota, vendaSimplesAm } from './testes/notas';

const emissor = criarEmissorNFe();
const { a1 } = a1DeTesteAberto();

const grupoXml = (xml: string, nome: string) => new RegExp(`<${nome}>[\\s\\S]*?</${nome}>`).exec(xml)?.[0] ?? '';
const tags = (xml: string) => [...xml.matchAll(/<(\w+)>/g)].map((m) => m[1]!);
const tag = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'g'))].map((m) => m[1]);

/** A nota com outro IPI no item (inclusive inválido, para os testes de recusa). */
const comIpi = (g: Record<string, unknown>): NotaParaEmissaoEntrada => {
  const item = nota.itens[0]!;
  return { ...nota, itens: [{ ...item, imposto: { ...item.imposto, IPI: g as never } }] };
};
const comTrib = (t: Record<string, unknown>) => comIpi({ cEnq: '999', IPITrib: t });
const ocorrencias = (entrada: NotaParaEmissaoEntrada): readonly string[] => {
  try {
    montarNFe(entrada);
  } catch (e) {
    if (e instanceof ErroMontagemNFe) return e.ocorrencias;
    throw e;
  }
  return [];
};
const xsd = async (entrada: NotaParaEmissaoEntrada) => (await validarXsd(emissor.assinar(emissor.montar(entrada).xml, a1).xml, 'nfe')).erros;
const DIVERGE = 'itens[0].imposto.IPI.IPITrib.vIPI: difere do calculado (tolerância 1 centavo)';

describe('IPI no emissor, RN-FIS-03', () => {
  it('IPITrib por percentual, por unidade e zerado, e o IPINT, assinados, passam no XSD do PL_010g (nfe)', async () => {
    expect(await xsd(nota)).toEqual([]);
    expect(await xsd(comTrib({ CST: '99', qUnid: '3', vUnid: '1.2345', vIPI: 370 }))).toEqual([]);
    expect(await xsd(comTrib({ CST: '50', vBC: 0, pIPI: '0', vIPI: 0 }))).toEqual([]);
    for (const CST of ['01', '05', '51', '55']) expect(await xsd(comIpi({ cEnq: '001', IPINT: { CST } })), CST).toEqual([]);
  });

  it('ordem do XSD: no imposto, depois do ICMS e antes do PIS; dentro do grupo, cEnq e IPITrib (CST, vBC, pIPI, vIPI)', () => {
    const xml = montarNFe(nota).xml;
    const blocos = ['ICMS', 'IPI', 'PIS', 'COFINS', 'IBSCBS'];
    expect(tags(grupoXml(xml, 'imposto')).filter((t) => blocos.includes(t))).toEqual(['ICMS', 'IPI', 'PIS', 'COFINS', 'IBSCBS']);
    expect(grupoXml(xml, 'IPI')).toBe('<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>99.90</vBC><pIPI>5.0000</pIPI><vIPI>5.00</vIPI></IPITrib></IPI>');
    const tot = tags(grupoXml(xml, 'ICMSTot'));
    expect(tot.slice(tot.indexOf('vII'), tot.indexOf('vPIS') + 1)).toEqual(['vII', 'vIPI', 'vIPIDevol', 'vPIS']);
  });

  it('por unidade: qUnid e vUnid com 4 casas; IPINT só com o CST', () => {
    const porUnidade = montarNFe(comTrib({ CST: '99', qUnid: '3', vUnid: '1.2345', vIPI: 370 })).xml;
    expect(grupoXml(porUnidade, 'IPITrib')).toBe('<IPITrib><CST>99</CST><qUnid>3.0000</qUnid><vUnid>1.2345</vUnid><vIPI>3.70</vIPI></IPITrib>');
    expect(grupoXml(montarNFe(comIpi({ cEnq: '001', IPINT: { CST: '53' } })).xml, 'IPI')).toBe('<IPI><cEnq>001</cEnq><IPINT><CST>53</CST></IPINT></IPI>');
  });

  it('total: o vIPI do ICMSTot é a soma dos itens e entra no vNF, no vItem e no vNFTot; o IPINT não soma', () => {
    const item = nota.itens[0]!;
    const naoTributado = { ...item, cProd: 'P0003', imposto: { ...item.imposto, IPI: { cEnq: '999', IPINT: { CST: '53' } as const } } };
    const tres: NotaParaEmissaoEntrada = { ...nota, itens: [item, { ...item, cProd: 'P0002' }, naoTributado] };
    const xml = montarNFe(tres).xml;
    const tot = grupoXml(xml, 'ICMSTot');
    const doItem = tag(xml.slice(0, xml.indexOf('<total>')), 'vIPI');
    expect(doItem).toEqual(['5.00', '5.00']);
    const somaItens = doItem.reduce((s, x) => s + Math.round(Number(x) * 100), 0);
    expect(tag(tot, 'vIPI')).toEqual([(somaItens / 100).toFixed(2)]);
    expect(tag(tot, 'vNF')).toEqual(['309.70']); // 3 × 99,90 + 2 × 5,00
    expect(tag(xml, 'vItem')).toEqual(['104.90', '104.90', '99.90']);
    expect(tag(xml, 'vNFTot')).toEqual(['309.70']);
  });

  it('sem IPI em nenhum item, o item não leva o grupo e o vIPI do total é 0,00', () => {
    const xml = montarNFe(vendaSimplesAm).xml;
    expect(xml).not.toContain('<IPI>');
    expect(tag(grupoXml(xml, 'ICMSTot'), 'vIPI')).toEqual(['0.00']);
  });

  it('arredondamento do Manual: 99,90 × 5% = 4,995 → 5,00 (meio para cima); fora da tolerância de 1 centavo é recusado', () => {
    expect(ocorrencias(nota)).toEqual([]);
    expect(ocorrencias(comTrib({ ...IPI_DE_TESTE.IPITrib, vIPI: 498 }))).toEqual([DIVERGE]);
    expect(ocorrencias(comTrib({ CST: '99', qUnid: '3', vUnid: '1.2345', vIPI: 372 }))).toEqual([DIVERGE]);
  });

  it('recusa CST fora do grupo, os dois grupos ou nenhum, a base pela metade ou misturada, cEnq e valor inválidos', () => {
    const p = 'itens.0.imposto.IPI';
    expect(ocorrencias(comTrib({ ...IPI_DE_TESTE.IPITrib, CST: '51' }))[0]).toMatch(new RegExp(`^${p}\\.IPITrib\\.CST: `));
    expect(ocorrencias(comIpi({ cEnq: '999', IPINT: { CST: '50' } }))[0]).toMatch(new RegExp(`^${p}\\.IPINT\\.CST: `));
    expect(ocorrencias(comIpi({ cEnq: '999' }))).toEqual([`${p}.IPITrib: IPI leva IPITrib ou IPINT (um só)`]);
    expect(ocorrencias(comIpi({ ...IPI_DE_TESTE, IPINT: { CST: '53' } }))).toEqual([`${p}.IPITrib: IPI leva IPITrib ou IPINT (um só)`]);
    expect(ocorrencias(comTrib({ CST: '50', vIPI: 0 }))).toEqual([`${p}.IPITrib.vBC: IPITrib exige vBC e pIPI ou qUnid e vUnid`]);
    expect(ocorrencias(comTrib({ CST: '50', vBC: 9990, vIPI: 500 }))).toEqual([`${p}.IPITrib.pIPI: vBC e pIPI vão juntos`]);
    expect(ocorrencias(comTrib({ CST: '99', vUnid: '1.2345', vIPI: 370 }))).toEqual([`${p}.IPITrib.qUnid: qUnid e vUnid vão juntos`]);
    expect(ocorrencias(comTrib({ ...IPI_DE_TESTE.IPITrib, qUnid: '3', vUnid: '1' }))).toEqual([
      `${p}.IPITrib.qUnid: IPITrib leva vBC e pIPI ou qUnid e vUnid, não os dois`,
    ]);
    expect(ocorrencias(comIpi({ ...IPI_DE_TESTE, cEnq: '99' }))).toEqual([`${p}.cEnq: 3 dígitos`]);
    expect(ocorrencias(comTrib({ ...IPI_DE_TESTE.IPITrib, vIPI: 5.5 }))[0]).toMatch(new RegExp(`^${p}\\.IPITrib\\.vIPI: `));
    expect(ocorrencias(comTrib({ ...IPI_DE_TESTE.IPITrib, pIPI: '5.12345' }))[0]).toMatch(new RegExp(`^${p}\\.IPITrib\\.pIPI: `));
  });
});
