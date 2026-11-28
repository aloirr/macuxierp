/**
 * T-0128 (parte do emissor): grupo ICMSUFDest (DIFAL, NA01) no item e os totais vFCPUFDest, vICMSUFDest e vICMSUFRemet
 * no ICMSTot, na ordem do XSD do PL_010g (leiauteNFe_v4.00.xsd:5145), só com idDest 2 e indFinal 1 (RN-FIS-06).
 * O cálculo do DIFAL é do modulo-fiscal; se ele entra no vNF é pendência do fiscal e do faturamento (hoje fica fora).
 */
import { validarXsd } from '@macuxierp/nfe-sefaz';
import { describe, expect, it } from 'vitest';
import { criarEmissorNFe } from './emissor';
import type { NotaParaEmissaoEntrada } from './entrada';
import { ErroMontagemNFe, montarNFe } from './montar';
import { a1DeTesteAberto } from './testes/a1';
import {
  ICMS_UF_DEST_DE_TESTE,
  vendaInterestadual,
  vendaInterestadualConsumidorFinal as nota,
} from './testes/notas';

const emissor = criarEmissorNFe();
const { a1 } = a1DeTesteAberto();

const grupoXml = (xml: string, nome: string) =>
  new RegExp(`<${nome}>[\\s\\S]*?</${nome}>`).exec(xml)?.[0] ?? '';
const tags = (xml: string) => [...xml.matchAll(/<(\w+)>/g)].map((m) => m[1]!);
const tag = (xml: string, nome: string) =>
  [...xml.matchAll(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'g'))].map((m) => m[1]);

const comIde = (ide: Partial<NotaParaEmissaoEntrada['ide']>): NotaParaEmissaoEntrada => ({
  ...nota,
  ide: { ...nota.ide, ...ide },
});
/** A nota com outro ICMSUFDest no item (inclusive inválido, para os testes de recusa). */
const comGrupo = (g: Record<string, unknown>): NotaParaEmissaoEntrada => {
  const item = nota.itens[0]!;
  return { ...nota, itens: [{ ...item, imposto: { ...item.imposto, ICMSUFDest: g as never } }] };
};
const ocorrencias = (entrada: NotaParaEmissaoEntrada): readonly string[] => {
  try {
    montarNFe(entrada);
  } catch (e) {
    if (e instanceof ErroMontagemNFe) return e.ocorrencias;
    throw e;
  }
  return [];
};

describe('ICMSUFDest (DIFAL) no emissor, RN-FIS-06', () => {
  it('a nota com o grupo, assinada, passa no XSD do PL_010g (nfe)', async () => {
    const assinada = emissor.assinar(emissor.montar(nota).xml, a1);
    expect((await validarXsd(assinada.xml, 'nfe')).erros).toEqual([]);
  });

  it('sem o FCP e com pICMSInter 4 e 7 também passa no XSD', async () => {
    const { vBCFCPUFDest: _b, pFCPUFDest: _p, vFCPUFDest: _v, ...semFcp } = ICMS_UF_DEST_DE_TESTE;
    for (const pICMSInter of ['4', '7']) {
      const assinada = emissor.assinar(emissor.montar(comGrupo({ ...semFcp, pICMSInter })).xml, a1);
      expect((await validarXsd(assinada.xml, 'nfe')).erros, pICMSInter).toEqual([]);
    }
  });

  it('ordem do XSD: no imposto, depois do COFINS e antes do IBSCBS; dentro do grupo, NA03 a NA17', () => {
    const xml = montarNFe(nota).xml;
    const blocos = ['ICMS', 'PIS', 'COFINS', 'ICMSUFDest', 'IS', 'IBSCBS'];
    expect(tags(grupoXml(xml, 'imposto')).filter((t) => blocos.includes(t))).toEqual([
      'ICMS',
      'PIS',
      'COFINS',
      'ICMSUFDest',
      'IBSCBS',
    ]);
    expect(tags(grupoXml(xml, 'ICMSUFDest')).slice(1)).toEqual([
      'vBCUFDest',
      'vBCFCPUFDest',
      'pFCPUFDest',
      'pICMSUFDest',
      'pICMSInter',
      'pICMSInterPart',
      'vFCPUFDest',
      'vICMSUFDest',
      'vICMSUFRemet',
    ]);
    const tot = tags(grupoXml(xml, 'ICMSTot'));
    expect(tot.slice(tot.indexOf('vICMSDeson'), tot.indexOf('vFCP') + 1)).toEqual([
      'vICMSDeson',
      'vFCPUFDest',
      'vICMSUFDest',
      'vICMSUFRemet',
      'vFCP',
    ]);
  });

  it('centavos viram reais com 2 casas; alíquotas com 4; pICMSInter com 2 ("12.00"); partilha padrão 100', () => {
    expect(grupoXml(montarNFe(nota).xml, 'ICMSUFDest')).toBe(
      '<ICMSUFDest><vBCUFDest>99.90</vBCUFDest><vBCFCPUFDest>99.90</vBCFCPUFDest><pFCPUFDest>2.0000</pFCPUFDest><pICMSUFDest>19.0000</pICMSUFDest>' +
        '<pICMSInter>12.00</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>6.99</vICMSUFDest>' +
        '<vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>',
    );
  });

  it('totais somam os itens no ICMSTot e ficam fora do vNF (pendência do fiscal e do faturamento)', () => {
    const item = nota.itens[0]!;
    const dois: NotaParaEmissaoEntrada = {
      ...nota,
      itens: [item, { ...item, cProd: 'P0002' }],
      pag: { detPag: [{ indPag: 0, tPag: '01', vPag: 2 * item.vProd }] },
    };
    const tot = grupoXml(montarNFe(dois).xml, 'ICMSTot');
    expect([tag(tot, 'vFCPUFDest'), tag(tot, 'vICMSUFDest'), tag(tot, 'vICMSUFRemet')]).toEqual([
      ['4.00'],
      ['13.98'],
      ['0.00'],
    ]);
    expect(tag(tot, 'vNF')).toEqual(['199.80']);
  });

  it('sem o grupo em nenhum item, o ICMSTot não leva os três totais', () => {
    const xml = montarNFe(vendaInterestadual).xml;
    expect(xml).not.toContain('ICMSUFDest');
    expect(xml).not.toContain('vFCPUFDest');
  });

  it('recusa o grupo fora de idDest 2 com indFinal 1, citando o caminho', () => {
    const msg = 'itens.0.imposto.ICMSUFDest: RN-FIS-06: ICMSUFDest só com idDest 2 e indFinal 1';
    expect(ocorrencias(comIde({ idDest: 1 }))).toEqual([msg]);
    expect(ocorrencias(comIde({ idDest: 3 }))).toEqual([msg]);
    expect(ocorrencias(comIde({ indFinal: 0 }))).toEqual([msg]);
    expect(ocorrencias(nota)).toEqual([]);
  });

  it('recusa pICMSInter fora de 4, 7 e 12, o FCP pela metade e valor que não é centavo inteiro', () => {
    expect(ocorrencias(comGrupo({ ...ICMS_UF_DEST_DE_TESTE, pICMSInter: '18' }))).toEqual([
      'itens.0.imposto.ICMSUFDest.pICMSInter: pICMSInter só 4, 7 ou 12 (XSD)',
    ]);
    const { vFCPUFDest: _v, ...semValorFcp } = ICMS_UF_DEST_DE_TESTE;
    expect(ocorrencias(comGrupo(semValorFcp))).toEqual([
      'itens.0.imposto.ICMSUFDest.vFCPUFDest: pFCPUFDest e vFCPUFDest vão juntos',
    ]);
    expect(ocorrencias(comGrupo({ ...ICMS_UF_DEST_DE_TESTE, vICMSUFDest: 6.99 }))[0]).toMatch(
      /^itens\.0\.imposto\.ICMSUFDest\.vICMSUFDest: /,
    );
    const { vICMSUFRemet: _r, ...semRemet } = ICMS_UF_DEST_DE_TESTE;
    expect(ocorrencias(comGrupo(semRemet))[0]).toMatch(/^itens\.0\.imposto\.ICMSUFDest\.vICMSUFRemet: /);
  });
});
