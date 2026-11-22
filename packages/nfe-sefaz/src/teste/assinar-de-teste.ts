/**
 * Assinatura XMLDSig SÓ DE TESTE, no padrão da NF-e (enveloped, C14N 2001, RSA-SHA1, SHA-1, `Reference URI="#Id"`,
 * certificado no `X509Data`), com o `xml-crypto` (ADR 0008). Assina NF-e, evento e inutilização de teste, inclusive
 * XML forjado. O assinador de produção só assina o que o emissor monta (forma canônica); XML forjado precisa deste
 * arquivo.
 */
import { SignedXml } from 'xml-crypto';
import { ALGORITMOS_XMLDSIG_NFE, type ElementoAssinado } from '../xmldsig';
import type { A1DeTeste } from './a1-de-teste';

function base64DoPem(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

/** Assina o elemento (`infNFe`, `infEvento` ou `infInut`) e põe a `<Signature>` logo depois dele, como pede o leiaute. */
export function assinarXmlDeTeste(xml: string, o: { elemento: ElementoAssinado; a1: Pick<A1DeTeste, 'chavePrivadaPem' | 'certificadoPem'> }): string {
  const { chavePrivadaPem, certificadoPem } = o.a1;
  const certificado = base64DoPem(certificadoPem);
  const sig = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: ALGORITMOS_XMLDSIG_NFE.assinatura,
    canonicalizationAlgorithm: ALGORITMOS_XMLDSIG_NFE.c14n,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certificado}</X509Certificate></X509Data>`,
  });
  const caminho = `//*[local-name(.)='${o.elemento}']`;
  sig.addReference({
    xpath: caminho,
    transforms: [...ALGORITMOS_XMLDSIG_NFE.transformacoes],
    digestAlgorithm: ALGORITMOS_XMLDSIG_NFE.digest,
  });
  sig.computeSignature(xml, { location: { reference: caminho, action: 'after' } });
  return sig.getSignedXml();
}
