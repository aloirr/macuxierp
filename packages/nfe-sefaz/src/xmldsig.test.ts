/** Verificador XMLDSig (xml-crypto): padrão da NF-e, CNPJ do certificado (213), validade, embrulho e o 202 por dublê. */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { CNPJ_OUTRO_DE_TESTE, INSTANTE_DE_TESTE, VALIDADE_DE_TESTE, assinarXmlDeTeste, gerarA1DeTeste, montarInutilizacaoDeTeste, montarNFeDeTeste } from './teste';
import {
  CSTAT_FALHA_ASSINATURA,
  ERRO_XML_CRYPTO_DIFERE,
  NS_NFE,
  NS_XMLDSIG,
  cnpjDoCertificado,
  filhoNfe,
  lerXml,
  verificarAssinaturaNFe,
  verificarAssinaturaXml,
} from './xmldsig';

const AGORA = INSTANTE_DE_TESTE;
const a1 = gerarA1DeTeste(VALIDADE_DE_TESTE);
const nfe = montarNFeDeTeste({ nNF: 1, dhEmi: AGORA });
const assinada = assinarXmlDeTeste(nfe.xml, { elemento: 'infNFe', a1 });

describe('verificarAssinaturaXml', () => {
  it('confere a NF-e: Id, DigestValue (o digVal) e o CNPJ do certificado', () => {
    const r = verificarAssinaturaNFe(assinada, { cnpjEsperado: a1.cnpj, agora: AGORA });
    expect(r).toMatchObject({ ok: true, id: `NFe${nfe.chave}`, certificado: { cnpj: a1.cnpj } });
    if (r.ok) expect(r.digestValue).toBe(/<DigestValue>([^<]+)</.exec(assinada)![1]);
  });

  it('213: CNPJ-base do emitente diferente do certificado; filial da mesma raiz passa', () => {
    expect(verificarAssinaturaNFe(assinada, { cnpjEsperado: CNPJ_OUTRO_DE_TESTE, agora: AGORA })).toEqual({ ok: false, falha: 'cnpj_difere_do_certificado', cStat: '213' });
    expect(verificarAssinaturaNFe(assinada, { cnpjEsperado: '11222333000262', agora: AGORA }).ok).toBe(true);
  });

  it('297 conteúdo alterado; 298 algoritmo, referência ou posição fora do padrão', () => {
    expect(verificarAssinaturaNFe(assinada.replace('<vNF>10.00</vNF>', '<vNF>10.01</vNF>'), { agora: AGORA })).toMatchObject({ cStat: '297' });
    expect(verificarAssinaturaNFe(assinada.replace(/#rsa-sha1/, '#rsa-sha256'), { agora: AGORA })).toMatchObject({ cStat: '298' });
    expect(verificarAssinaturaNFe(assinada.replace('URI="#NFe', 'URI="#X'), { agora: AGORA })).toMatchObject({ cStat: '298' });
    expect(verificarAssinaturaNFe(assinada.replace('enveloped-signature', 'enveloped-signaturX'), { agora: AGORA })).toMatchObject({ cStat: '298' });
    expect(verificarAssinaturaNFe(nfe.xml, { agora: AGORA })).toMatchObject({ falha: 'sem_assinatura', cStat: '298' });
    expect(verificarAssinaturaNFe('<NFe', { agora: AGORA })).toMatchObject({ falha: 'sem_assinatura' });
  });

  it('contra o embrulho: outro elemento com o mesmo Id ou duas assinaturas dão 298', () => {
    const dup = assinada.replace('<transp>', `<transp><infAdic Id="NFe${nfe.chave}"/>`);
    expect(verificarAssinaturaNFe(dup, { agora: AGORA })).toMatchObject({ cStat: '298' });
    const sig = /<Signature[\s\S]*<\/Signature>/.exec(assinada)![0];
    expect(verificarAssinaturaNFe(assinada.replace('</NFe>', `${sig}</NFe>`), { agora: AGORA })).toMatchObject({ cStat: '298' });
  });

  it('291 fora da validade; 292 sem CNPJ; 290 certificado ilegível', () => {
    expect(verificarAssinaturaNFe(assinada, { agora: new Date('2028-01-01T00:00:00Z') })).toMatchObject({ cStat: '291' });
    const semCnpj = gerarA1DeTeste({ ...VALIDADE_DE_TESTE, semCnpj: true });
    expect(verificarAssinaturaNFe(assinarXmlDeTeste(nfe.xml, { elemento: 'infNFe', a1: semCnpj }), { agora: AGORA })).toMatchObject({ cStat: '292' });
    expect(verificarAssinaturaNFe(assinada.replace(/<X509Certificate>[^<]+/, '<X509Certificate>QUJD'), { agora: AGORA })).toMatchObject({ cStat: '290' });
  });

  it('inutilização: confere o infInut', () => {
    const inut = assinarXmlDeTeste(montarInutilizacaoDeTeste({ ano: '26', nNFIni: 1, nNFFin: 1 }), { elemento: 'infInut', a1 });
    expect(verificarAssinaturaXml(inut, { elemento: 'infInut', cnpjEsperado: a1.cnpj, agora: AGORA }).ok).toBe(true);
    expect(verificarAssinaturaXml(inut, { elemento: 'infNFe', agora: AGORA })).toMatchObject({ cStat: '298' });
  });

  it('cnpjDoCertificado segue o titular ICP-Brasil e confere o DV', () => {
    expect(cnpjDoCertificado('CN=EMPRESA LTDA:11222333000181\nO=ICP-Brasil')).toBe('11222333000181');
    expect(cnpjDoCertificado('CN=EMPRESA LTDA:11222333000182')).toBeNull();
    expect(cnpjDoCertificado('CN=EMPRESA LTDA')).toBeNull();
  });

  it('297 × 202 travado no xml-crypto 6.4.0: digest ou valor adulterado vira 297, nunca 202', () => {
    // Trocou a versão? Reveja ERRO_XML_CRYPTO_DIFERE (xmldsig.ts): a escolha 297 × 202 depende das mensagens dela.
    expect((createRequire(import.meta.url)('xml-crypto/package.json') as { version: string }).version).toBe('6.4.0');
    const adulteradas = {
      digest: assinada.replace('<vNF>10.00</vNF>', '<vNF>10.01</vNF>'),
      valor: assinada.replace(/<SignatureValue>(.)/, (_m, c: string) => `<SignatureValue>${c === 'A' ? 'B' : 'A'}`),
    };
    for (const [nome, xml] of Object.entries(adulteradas)) {
      const sig = lerXml(xml)!.getElementsByTagNameNS(NS_XMLDSIG, 'Signature')[0]!;
      const sx = new SignedXml({ publicCert: a1.certificadoPem, getCertFromKeyInfo: () => null });
      sx.loadSignature(sig);
      let saida: boolean | Error;
      try {
        saida = sx.checkSignature(xml);
      } catch (e) {
        saida = e as Error;
      }
      if (saida instanceof Error) expect(saida.message, nome).toMatch(ERRO_XML_CRYPTO_DIFERE);
      else expect(saida, nome).toBe(false);
      expect(verificarAssinaturaNFe(xml, { agora: AGORA }), nome).toEqual({ ok: false, falha: 'difere_do_calculado', cStat: '297' });
    }
    expect(ERRO_XML_CRYPTO_DIFERE.test('falha interna qualquer')).toBe(false);
  });

  it('DOCTYPE (qualquer caixa) é recusado antes do parse: sem DTD nem entidade externa', () => {
    for (const dtd of ['<!DOCTYPE NFe [<!ENTITY x SYSTEM "file:///etc/passwd">]>', '<!doctype NFe>']) {
      expect(lerXml(`${dtd}${assinada}`)).toBeNull();
      expect(verificarAssinaturaNFe(`${dtd}${assinada}`, { agora: AGORA })).toMatchObject({ ok: false, falha: 'sem_assinatura' });
    }
  });

  it('filhoNfe segue só o caminho do leiaute, no namespace da NF-e', () => {
    const inf = filhoNfe(lerXml(assinada)!.documentElement, 'infNFe');
    expect(filhoNfe(inf, 'emit', 'CNPJ')?.textContent).toBe(a1.cnpj);
    expect(filhoNfe(inf, 'CNPJ')).toBeNull();
    expect(filhoNfe(lerXml(`<NFe xmlns="x${NS_NFE}"><infNFe/></NFe>`)!.documentElement, 'infNFe')).toBeNull();
  });

  it('202: exceção inesperada dentro da verificação (dublê do xml-crypto)', async () => {
    vi.resetModules();
    vi.doMock('xml-crypto', () => ({
      SignedXml: class {
        loadSignature() {}
        checkSignature(): boolean {
          throw new Error('falha interna qualquer');
        }
      },
    }));
    const { verificarAssinaturaNFe: comDuble } = await import('./xmldsig');
    expect(comDuble(assinada, { agora: AGORA })).toEqual({ ok: false, falha: 'falha_na_verificacao', cStat: '202' });
    expect(CSTAT_FALHA_ASSINATURA.falha_na_verificacao).toBe('202');
    vi.doUnmock('xml-crypto');
  });
});
