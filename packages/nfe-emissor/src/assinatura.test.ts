import { createHash, generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import { inspect } from 'node:util';
import { INSTANTE_DE_TESTE, VALIDADE_DE_TESTE, gerarA1DeTeste } from '@macuxierp/nfe-sefaz/teste';
import { ALGORITMOS_XMLDSIG_NFE as ALG, verificarAssinaturaNFe, verificarAssinaturaXml } from '@macuxierp/nfe-sefaz';
import { ErroCertificado } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { assinarDocumento, assinarNFe, ErroAssinaturaNFe } from './assinatura';
import { abrirA1, ErroCertificadoA1 } from './certificado';
import { montarCancelamento, montarInutilizacao } from './eventos';
import { montarNFe } from './montar';
import { a1DeTesteAberto } from './testes/a1';
import { NOTAS, vendaSimplesAm } from './testes/notas';

const AGORA = INSTANTE_DE_TESTE;
const { gerado, a1 } = a1DeTesteAberto();

/**
 * PKCS#12 sem cifra nem MAC com uma chave EC (P-256) e o certificado do A1 de teste: o forge não escreve PKCS#12 com
 * chave que não seja RSA, então o PFX é montado em ASN.1 (RFC 7292: keyBag e certBag num SafeContents).
 */
function pfxComChaveEc(): Uint8Array {
  const a = forge.asn1;
  const seq = (v: forge.asn1.Asn1[]) => a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, v);
  const oid = (o: string) => a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(o).getBytes());
  const ctx0 = (v: forge.asn1.Asn1) => a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [v]);
  const octetos = (b: string) => a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, b);
  const dados = (der: string) => seq([oid(forge.pki.oids.data!), ctx0(octetos(der))]);
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'der' });
  const certDer = a.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(gerado.certificadoPem))).getBytes();
  const bolsas = seq([
    seq([oid('1.2.840.113549.1.12.10.1.1'), ctx0(a.fromDer(ec.toString('binary')))]),
    seq([oid('1.2.840.113549.1.12.10.1.3'), ctx0(seq([oid('1.2.840.113549.1.9.22.1'), ctx0(octetos(certDer))]))]),
  ]);
  const pfx = seq([a.create(a.Class.UNIVERSAL, a.Type.INTEGER, false, String.fromCharCode(3)), dados(a.toDer(seq([dados(a.toDer(bolsas).getBytes())])).getBytes())]);
  return Buffer.from(a.toDer(pfx).getBytes(), 'binary');
}

describe('A1 em memória (ADR 0005)', () => {
  it('abre o PKCS#12 e lê o CNPJ do SAN ICP-Brasil e a impressão digital pela função única do platform-sdk (RD-0294)', () => {
    expect(a1.cnpj).toBe(gerado.cnpj);
    expect(a1.impressaoDigital).toMatch(/^[0-9a-f]{64}$/);
    expect(a1.validoAte.toISOString()).toBe(VALIDADE_DE_TESTE.validoAte.toISOString());
    expect(a1.certificadoBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it('nunca vaza o material em JSON, inspect ou String', () => {
    expect(JSON.stringify({ a1 })).toBe('{"a1":"[CertificadoA1 redigido]"}');
    expect(inspect(a1)).toBe('[CertificadoA1 redigido]');
    expect(String(a1)).toBe('[CertificadoA1 redigido]');
    expect(Object.keys(a1)).not.toContain('chavePrivadaPem');
  });
  it('senha errada e certificado vencido dão erro sem conteúdo', () => {
    const g = gerarA1DeTeste({ validoDe: new Date('2020-01-01T00:00:00Z'), validoAte: new Date('2021-01-01T00:00:00Z') });
    expect(() => abrirA1(g.pfx, 'errada', AGORA)).toThrow(new ErroCertificadoA1('A1_ILEGIVEL'));
    expect(() => abrirA1(g.pfx, g.senha, AGORA)).toThrow(new ErroCertificadoA1('A1_FORA_DA_VALIDADE'));
  });
  it('qualquer ErroCertificado do SDK vira A1_SEM_CNPJ com o cause (os 3 códigos são provados no SDK; RD-0294)', () => {
    const g = gerarA1DeTeste({ ...VALIDADE_DE_TESTE, cnpj: gerado.cnpj, cnpjNoCn: '11444777000161' });
    let erro: unknown;
    try {
      abrirA1(g.pfx, g.senha, AGORA);
    } catch (e) {
      erro = e;
    }
    expect(erro).toEqual(new ErroCertificadoA1('A1_SEM_CNPJ'));
    expect((erro as Error).cause).toEqual(new ErroCertificado('cnpj_divergente'));
    expect((erro as Error).message).not.toContain(g.senha);
  });
  it('chave que não é RSA (EC) vira A1_CHAVE_NAO_RSA, sem material no erro', () => {
    let erro: unknown;
    try {
      abrirA1(pfxComChaveEc(), '', AGORA);
    } catch (e) {
      erro = e;
    }
    expect(erro).toEqual(new ErroCertificadoA1('A1_CHAVE_NAO_RSA'));
    expect((erro as Error).message).toBe('Certificado A1 recusado: A1_CHAVE_NAO_RSA');
    expect((erro as Error).cause).toBeUndefined();
  });
});

describe('assinatura XMLDSig enveloped (C14N, RSA-SHA1, SHA-1)', () => {
  it('estrutura da Signature como o Manual pede, último filho de NFe', () => {
    const { xml } = assinarNFe(montarNFe(vendaSimplesAm).xml, a1);
    const { chave } = montarNFe(vendaSimplesAm);
    expect(xml).toMatch(/<\/infNFe><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><SignedInfo>/);
    expect(xml.endsWith('</Signature></NFe>')).toBe(true);
    expect(xml).toContain(`<Reference URI="#NFe${chave}"><Transforms><Transform Algorithm="${ALG.transformacoes[0]}"></Transform><Transform Algorithm="${ALG.c14n}"></Transform></Transforms>`);
    expect(xml).toContain(`<X509Certificate>${a1.certificadoBase64}</X509Certificate>`);
  });

  it('digest = SHA-1 do C14N do infNFe (com o xmlns herdado declarado)', () => {
    const montada = montarNFe(vendaSimplesAm);
    const { digVal } = assinarNFe(montada.xml, a1);
    const inf = montada.xml.replace('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe ', '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" ').replace(/<\/NFe>$/, '');
    expect(digVal).toBe(createHash('sha1').update(inf).digest('base64'));
  });

  it('C2: o verificador XMLDSig do nfe-sefaz aceita as 5 fixtures, com o CNPJ do SAN e o digVal (RD-0296)', () => {
    for (const nota of Object.values(NOTAS)) {
      const assinada = assinarNFe(montarNFe(nota).xml, a1);
      const r = verificarAssinaturaNFe(assinada.xml, { cnpjEsperado: gerado.cnpj, agora: AGORA });
      expect(r).toMatchObject({ ok: true, digestValue: assinada.digVal, certificado: { cnpj: gerado.cnpj, impressaoDigital: a1.impressaoDigital } });
    }
  });

  it('o verificador recusa a nota adulterada depois de assinada (297)', () => {
    const { xml } = assinarNFe(montarNFe(vendaSimplesAm).xml, a1);
    const adulterada = xml.replace('<vNF>21.00</vNF>', '<vNF>2.10</vNF>');
    expect(adulterada).not.toBe(xml);
    expect(verificarAssinaturaNFe(adulterada, { agora: AGORA })).toMatchObject({ ok: false, cStat: '297' });
  });

  it('a mesma função assina o evento (infEvento) e a inutilização (infInut), e o verificador aceita', () => {
    const { chave } = montarNFe(vendaSimplesAm);
    const evento = montarCancelamento({ chNFe: chave, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: AGORA, nProt: '913260000000001', xJust: 'Cancelamento de teste do emissor' });
    const ev = assinarDocumento(evento, a1, 'infEvento');
    expect(verificarAssinaturaXml(ev.xml, { elemento: 'infEvento', cnpjEsperado: gerado.cnpj, agora: AGORA })).toMatchObject({ ok: true, digestValue: ev.digVal });
    const inut = assinarDocumento(montarInutilizacao({ cUF: 13, tpAmb: 2, ano: '26', cnpj: gerado.cnpj, serie: 1, nNFIni: 90, nNFFin: 91, xJust: 'Inutilizacao de teste do emissor' }), a1, 'infInut');
    expect(verificarAssinaturaXml(inut.xml, { elemento: 'infInut', cnpjEsperado: gerado.cnpj, agora: AGORA }).ok).toBe(true);
  });

  it('recusa XML já assinado, que não saiu do montador, ou com o elemento trocado', () => {
    const montada = montarNFe(vendaSimplesAm).xml;
    const { xml } = assinarNFe(montada, a1);
    expect(() => assinarNFe(xml, a1)).toThrow(new ErroAssinaturaNFe('NFE_JA_ASSINADA'));
    expect(() => assinarNFe(`<?xml version="1.0"?>${montada}`, a1)).toThrow(new ErroAssinaturaNFe('NFE_XML_NAO_CANONICO'));
    expect(() => assinarDocumento(montada, a1, 'infEvento')).toThrow(new ErroAssinaturaNFe('NFE_XML_NAO_CANONICO'));
  });
});
