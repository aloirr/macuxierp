/**
 * Verificador XMLDSig da NF-e, dos eventos e da inutilização (desenho T-0045 §5, etapas 3 e 4; ADR 0008).
 * Reutilizável: o simulador confere o que recebe; o emissor (T-0018) confere o que acabou de assinar.
 *
 * Padrão do leiaute (Manual de Orientação do Contribuinte, assinatura digital):
 *  - `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` irmã do elemento assinado (`infNFe`, `infEvento`,
 *    `infInut`), uma só `Reference` com `URI="#<Id>"`;
 *  - C14N 1.0 (2001) no `SignedInfo`, transformações `enveloped-signature` + C14N, RSA-SHA1 e SHA-1;
 *  - o certificado no `KeyInfo/X509Data/X509Certificate`, com o CNPJ no titular (`CN=<NOME>:<CNPJ>`).
 * C14N e verificação: `xml-crypto` (JS puro). Leitura do certificado: `node:crypto` (`X509Certificate`). Sem rede:
 * não confere cadeia ICP-Brasil nem LCR (fica para a SEFAZ real, T-0046).
 *
 * O resultado nunca carrega o XML nem a chave; só o veredito, o `DigestValue` (vira o `digVal` do protocolo) e o
 * resumo do certificado.
 */
import { X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { cnpjRaiz, cnpjValido } from '@macuxierp/platform-sdk';
import { SignedXml } from 'xml-crypto';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
export const NS_XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';

/** Algoritmos exigidos pela SEFAZ na NF-e 4.00 (qualquer outro dá 298). */
export const ALGORITMOS_XMLDSIG_NFE = Object.freeze({
  c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  assinatura: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
  transformacoes: Object.freeze(['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'] as const),
} as const);

/** Elemento assinado em cada documento. */
export type ElementoAssinado = 'infNFe' | 'infEvento' | 'infInut';

export type FalhaAssinatura =
  /** Sem `<Signature>` irmã do elemento, ou XML mal formado. */
  | 'sem_assinatura'
  /** Algoritmo, transformação, `Reference` ou posição fora do padrão da NF-e. */
  | 'fora_do_padrao'
  /** O digest ou a assinatura não conferem (documento alterado ou chave errada). */
  | 'difere_do_calculado'
  /** Falha inesperada ao processar a assinatura. */
  | 'falha_na_verificacao'
  /** Certificado ilegível. */
  | 'certificado_invalido'
  | 'certificado_fora_da_validade'
  | 'certificado_sem_cnpj'
  /** O CNPJ-base do certificado difere do CNPJ-base esperado (emitente, autor do evento ou da inutilização). */
  | 'cnpj_difere_do_certificado';

/** `cStat` da SEFAZ para cada falha (Manual de Orientação, tabela de rejeições). */
export const CSTAT_FALHA_ASSINATURA = Object.freeze({
  sem_assinatura: '298',
  fora_do_padrao: '298',
  difere_do_calculado: '297',
  falha_na_verificacao: '202',
  certificado_invalido: '290',
  certificado_fora_da_validade: '291',
  certificado_sem_cnpj: '292',
  cnpj_difere_do_certificado: '213',
} as const satisfies Record<FalhaAssinatura, string>);

export interface CertificadoDaAssinatura {
  readonly cnpj: string;
  readonly validoDe: Date;
  readonly validoAte: Date;
  /** SHA-256 do certificado (hex, minúsculas), como no core. */
  readonly impressaoDigital: string;
}

export type ResultadoAssinatura =
  | {
      readonly ok: true;
      /** O `Id` do elemento assinado (ex.: `NFe1326...`). */
      readonly id: string;
      /** O `DigestValue` (base64): é o `digVal` do protocolo. */
      readonly digestValue: string;
      readonly certificado: CertificadoDaAssinatura;
    }
  | { readonly ok: false; readonly falha: FalhaAssinatura; readonly cStat: string };

export interface OpcoesVerificacao {
  elemento: ElementoAssinado;
  /** CNPJ do emitente (ou do autor): o CNPJ-base (8 primeiras posições) tem de ser o do certificado (213). */
  cnpjEsperado?: string;
  /** Instante da conferência da validade do certificado (padrão: agora). */
  agora?: Date;
}

/**
 * Mensagem com que o `xml-crypto` 6.4.0 lança quando o digest ou o valor da assinatura não confere: vira 297; qualquer
 * outra exceção vira 202. Travado em `xmldsig.test.ts` contra troca de versão da biblioteca.
 */
export const ERRO_XML_CRYPTO_DIFERE = /invalid signature|digest|does not match/i;

const falhou = (falha: FalhaAssinatura): ResultadoAssinatura => ({ ok: false, falha, cStat: CSTAT_FALHA_ASSINATURA[falha] });

/** CNPJ do titular no padrão ICP-Brasil (`CN=<NOME>:<CNPJ>`), com o DV conferido. `null` se não houver. */
export function cnpjDoCertificado(sujeito: string): string | null {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(sujeito)?.[1] ?? '';
  const m = /:([0-9A-Z]{12}\d{2})\s*$/.exec(cn);
  return m?.[1] && cnpjValido(m[1]) ? m[1] : null;
}

function filhos(el: Element, ns: string, nome: string): Element[] {
  const r: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === nome) r.push(n as Element);
  }
  return r;
}

function filho(el: Element | undefined, ns: string, nome: string): Element | undefined {
  if (!el) return undefined;
  const r = filhos(el, ns, nome);
  return r.length === 1 ? r[0] : undefined;
}

/**
 * Filho direto no namespace da NF-e, seguindo o caminho (`filhoNfe(inf, 'emit', 'CNPJ')`): o primeiro de cada nome.
 * Só pelos caminhos do leiaute, nunca por busca solta (que pegaria o `CNPJ` do transportador no lugar do emitente).
 */
export function filhoNfe(el: Element | null | undefined, ...caminho: string[]): Element | null {
  let atual: Element | null = el ?? null;
  for (const nome of caminho) {
    if (!atual) return null;
    let achado: Element | null = null;
    for (let n = atual.firstChild; n && !achado; n = n.nextSibling) {
      if (n.nodeType === 1 && (n as Element).namespaceURI === NS_NFE && (n as Element).localName === nome) achado = n as Element;
    }
    atual = achado;
  }
  return atual;
}

/** `<!DOCTYPE`, em qualquer caixa: a NF-e não usa DTD, e DTD abre a porta para entidades externas (XXE). */
const DOCTYPE = /<!DOCTYPE/i;

/** O texto traz uma declaração de DTD? Quem recebe XML de fora recusa antes de qualquer parse. */
export function temDoctype(xml: string): boolean {
  return DOCTYPE.test(xml);
}

/**
 * Documento bem formado (DOM do `@xmldom/xmldom`, o mesmo do `xml-crypto`) ou `null`. Recusa `<!DOCTYPE` antes do
 * parse. Única leitura de XML recebido do `nfe-sefaz` e do simulador.
 */
export function lerXml(xml: string): Document | null {
  if (temDoctype(xml)) return null;
  let erro = false;
  const marcar = () => {
    erro = true;
  };
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: marcar, fatalError: marcar } }).parseFromString(xml, 'text/xml');
  return erro || !doc?.documentElement ? null : doc;
}

/** Assinatura no padrão do leiaute? Devolve o `SignedInfo`/`Reference` já conferidos ou `null`. */
function conferirPadrao(sig: Element, id: string): { digestValue: string; certificadoB64: string } | null {
  const A = ALGORITMOS_XMLDSIG_NFE;
  const signedInfo = filho(sig, NS_XMLDSIG, 'SignedInfo');
  const c14n = filho(signedInfo, NS_XMLDSIG, 'CanonicalizationMethod');
  const metodo = filho(signedInfo, NS_XMLDSIG, 'SignatureMethod');
  const refs = signedInfo ? filhos(signedInfo, NS_XMLDSIG, 'Reference') : [];
  const ref = refs.length === 1 ? refs[0] : undefined;
  if (!signedInfo || c14n?.getAttribute('Algorithm') !== A.c14n || metodo?.getAttribute('Algorithm') !== A.assinatura) return null;
  if (!ref || ref.getAttribute('URI') !== `#${id}`) return null;
  const transforms = filho(ref, NS_XMLDSIG, 'Transforms');
  const algs = transforms ? filhos(transforms, NS_XMLDSIG, 'Transform').map((t) => t.getAttribute('Algorithm')) : [];
  if (algs.length !== A.transformacoes.length || algs.some((a, i) => a !== A.transformacoes[i])) return null;
  if (filho(ref, NS_XMLDSIG, 'DigestMethod')?.getAttribute('Algorithm') !== A.digest) return null;
  const digestValue = filho(ref, NS_XMLDSIG, 'DigestValue')?.textContent?.trim() ?? '';
  const x509 = filho(filho(filho(sig, NS_XMLDSIG, 'KeyInfo'), NS_XMLDSIG, 'X509Data'), NS_XMLDSIG, 'X509Certificate');
  const certificadoB64 = x509?.textContent?.replace(/\s+/g, '') ?? '';
  if (!digestValue || !certificadoB64) return null;
  return { digestValue, certificadoB64 };
}

/**
 * Confere a assinatura do elemento pedido. Não lança por documento ruim: devolve `ok: false` com a falha e o `cStat`.
 *
 * Contra o ataque de "embrulho" (signature wrapping): exige um único elemento assinado na raiz do documento (ou no
 * `<evento>`/`<inutNFe>` raiz), um único atributo `Id` com aquele valor no documento inteiro e a `Signature` irmã dele.
 */
export function verificarAssinaturaXml(xml: string, o: OpcoesVerificacao): ResultadoAssinatura {
  const doc = lerXml(xml);
  if (!doc) return falhou('sem_assinatura');
  const raiz = doc.documentElement!;
  const alvos = filhos(raiz, NS_NFE, o.elemento);
  const alvo = alvos.length === 1 ? alvos[0]! : undefined;
  if (!alvo) return falhou('fora_do_padrao');
  const id = alvo.getAttribute('Id') ?? '';
  const sigs = filhos(raiz, NS_XMLDSIG, 'Signature');
  if (sigs.length === 0) return falhou('sem_assinatura');
  if (sigs.length > 1 || !id) return falhou('fora_do_padrao');
  const comMesmoId = Array.from(doc.getElementsByTagName('*')).filter((e) => e.getAttribute('Id') === id || e.getAttribute('ID') === id || e.getAttribute('id') === id);
  if (comMesmoId.length !== 1) return falhou('fora_do_padrao');
  const sig = sigs[0]!;
  const padrao = conferirPadrao(sig, id);
  if (!padrao) return falhou('fora_do_padrao');

  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(Buffer.from(padrao.certificadoB64, 'base64'));
  } catch {
    return falhou('certificado_invalido');
  }
  const pem = x509.toString();

  try {
    const sx = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
    sx.loadSignature(sig);
    if (!sx.checkSignature(xml)) return falhou('difere_do_calculado');
  } catch (e) {
    // xml-crypto lança quando a referência não confere ("invalid signature: for uri ...") ou o valor não bate.
    return falhou(ERRO_XML_CRYPTO_DIFERE.test(String((e as Error)?.message)) ? 'difere_do_calculado' : 'falha_na_verificacao');
  }

  const agora = o.agora ?? new Date();
  const validoDe = new Date(x509.validFrom);
  const validoAte = new Date(x509.validTo);
  if (agora < validoDe || agora > validoAte) return falhou('certificado_fora_da_validade');
  const cnpj = cnpjDoCertificado(x509.subject);
  if (!cnpj) return falhou('certificado_sem_cnpj');
  if (o.cnpjEsperado !== undefined && cnpjRaiz(o.cnpjEsperado) !== cnpjRaiz(cnpj)) return falhou('cnpj_difere_do_certificado');

  return {
    ok: true,
    id,
    digestValue: padrao.digestValue,
    certificado: { cnpj, validoDe, validoAte, impressaoDigital: x509.fingerprint256.replace(/:/g, '').toLowerCase() },
  };
}

/** Atalho para a NF-e: `infNFe` com o CNPJ do emitente. */
export function verificarAssinaturaNFe(xml: string, o: Omit<OpcoesVerificacao, 'elemento'> = {}): ResultadoAssinatura {
  return verificarAssinaturaXml(xml, { ...o, elemento: 'infNFe' });
}
