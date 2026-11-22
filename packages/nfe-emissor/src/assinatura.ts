/**
 * Assinatura XMLDSig enveloped dos documentos que o emissor monta: a NF-e (`infNFe`), os eventos (`infEvento`) e a
 * inutilização (`infInut`). C14N 1.0, RSA-SHA1 e SHA-1, `Reference URI="#<Id>"`, certificado em `KeyInfo/X509Data`
 * (Manual de Orientação do Contribuinte; algoritmos e namespaces do `@macuxierp/nfe-sefaz`, RD-0296).
 *
 * Porte em TypeScript da lógica do sped-common (`NFePHP\Common\Signer::sign`, usada pelo sped-nfe), opção MIT,
 * com atribuição: Copyright (c) NFePHP — https://github.com/nfephp-org/sped-common.
 * Diferença deliberada: em vez de reconstruir um DOM e canonicalizar, o emissor só assina o XML que ele mesmo
 * montou (já canônico, ver xml.ts) e insere a `Signature` como último filho da raiz por splice, sem reserializar.
 * A conferência OFICIAL é o verificador XMLDSig do nfe-sefaz (`verificarAssinaturaXml`), usado nos testes.
 */
import { createHash, createSign } from 'node:crypto';
import { ALGORITMOS_XMLDSIG_NFE as ALG, NS_NFE, NS_XMLDSIG, type ElementoAssinado } from '@macuxierp/nfe-sefaz';
import type { CertificadoA1EmMemoria } from './certificado';
import { serializar } from './xml';
import type { Elemento } from './xml';

export class ErroAssinaturaNFe extends Error {
  constructor(readonly codigo: 'NFE_XML_NAO_CANONICO' | 'NFE_JA_ASSINADA') {
    super(`Assinatura recusada: ${codigo}`);
    this.name = 'ErroAssinaturaNFe';
  }
}

/** Raiz de cada documento assinado e o formato do `Id` do elemento (NF-e: `NFe` + chave; evento e inutilização: `ID…`). */
const DOCUMENTO: Readonly<Record<ElementoAssinado, { raiz: string; id: RegExp }>> = Object.freeze({
  infNFe: { raiz: 'NFe', id: /^NFe[0-9A-Z]{44}$/ },
  infEvento: { raiz: 'evento', id: /^ID\d{6}[0-9A-Z]{44}\d{2}$/ },
  infInut: { raiz: 'inutNFe', id: /^ID\d{4}[0-9A-Z]{12}\d{25}$/ },
});

function signedInfo(id: string, digest: string): Elemento {
  const alg = (nome: string, a: string): Elemento => ({ nome, atributos: { Algorithm: a } });
  return {
    nome: 'SignedInfo',
    filhos: [
      alg('CanonicalizationMethod', ALG.c14n),
      alg('SignatureMethod', ALG.assinatura),
      {
        nome: 'Reference',
        atributos: { URI: `#${id}` },
        filhos: [
          { nome: 'Transforms', filhos: ALG.transformacoes.map((t) => alg('Transform', t)) },
          alg('DigestMethod', ALG.digest),
          { nome: 'DigestValue', filhos: [{ texto: digest }] },
        ],
      },
    ],
  };
}

export interface DocumentoAssinado {
  xml: string;
  /** DigestValue (base64). Na NF-e é o `digVal` que a SEFAZ devolve no protocolo. */
  digVal: string;
}

/**
 * Assina o documento devolvido pelo montador do emissor (`montarNFe`, `montarCancelamento`, `montarCartaCorrecao`,
 * `montarInutilizacao`). Recusa XML que não saiu do montador (forma não canônica) ou já assinado. Os bytes devolvidos
 * são os que vão para a SEFAZ e para a guarda; não reserialize.
 */
export function assinarDocumento(xml: string, a1: CertificadoA1EmMemoria, elemento: ElementoAssinado): DocumentoAssinado {
  const { raiz, id: formatoId } = DOCUMENTO[elemento];
  if (xml.includes('<Signature')) throw new ErroAssinaturaNFe('NFE_JA_ASSINADA');
  // A raiz só declara o namespace da NF-e (e a versão): nada mais entra no C14N do elemento por herança.
  const abre = new RegExp(`^<${raiz} xmlns="${NS_NFE}"(?: versao="[0-9.]+")?>`).exec(xml)?.[0];
  const fecha = `</${elemento}></${raiz}>`;
  if (!abre || !xml.endsWith(fecha)) throw new ErroAssinaturaNFe('NFE_XML_NAO_CANONICO');
  const corpo = xml.slice(abre.length, -`</${raiz}>`.length);
  const id = new RegExp(`^<${elemento} Id="([^"]+)"[ >]`).exec(corpo)?.[1];
  if (!id || !formatoId.test(id)) throw new ErroAssinaturaNFe('NFE_XML_NAO_CANONICO');

  // C14N do subdocumento: o namespace padrão herdado da raiz aparece declarado no próprio elemento.
  const canonico = `<${elemento} xmlns="${NS_NFE}"${corpo.slice(elemento.length + 1)}`;
  const digVal = createHash('sha1').update(canonico, 'utf8').digest('base64');

  const si = signedInfo(id, digVal);
  // C14N do SignedInfo: herda o namespace do xmldsig da Signature.
  const siCanonico = serializar({ ...si, xmlns: NS_XMLDSIG });
  const valor = createSign('RSA-SHA1').update(siCanonico, 'utf8').sign(a1.chavePrivadaPem, 'base64');

  const assinatura = serializar({
    nome: 'Signature',
    xmlns: NS_XMLDSIG,
    filhos: [
      si,
      { nome: 'SignatureValue', filhos: [{ texto: valor }] },
      { nome: 'KeyInfo', filhos: [{ nome: 'X509Data', filhos: [{ nome: 'X509Certificate', filhos: [{ texto: a1.certificadoBase64 }] }] }] },
    ],
  });
  return { xml: `${xml.slice(0, -`</${raiz}>`.length)}${assinatura}</${raiz}>`, digVal };
}

/** Atalho da porta `EmissorNFe`: assina a NF-e (`infNFe`). */
export function assinarNFe(xml: string, a1: CertificadoA1EmMemoria): DocumentoAssinado {
  return assinarDocumento(xml, a1, 'infNFe');
}
