/**
 * Certificado A1 em memória (ADR 0005): o PKCS#12 chega decifrado do banco, é aberto aqui e NUNCA vai para log,
 * erro, JSON ou snapshot. O objeto devolvido esconde o material em `inspect`/`toJSON`.
 *
 * PKCS#12 por `node-forge` (JS puro): o `node:crypto` não abre PFX, e o OpenSSL 3 recusa o PFX legado (RC2-40)
 * que muitas ACs ainda emitem. O PEM resultante serve à assinatura (`node:crypto`) e ao mTLS (`node:https`).
 */
import { X509Certificate } from 'node:crypto';
import { inspect } from 'node:util';
import { ErroCertificado, cnpjDoTitularIcp, impressaoDigitalSha256 } from '@macuxierp/platform-sdk';
import forge from 'node-forge';

/** Tipos de "bag" do PKCS#12 (RFC 7292). */
const BAG = Object.freeze({ chave: '1.2.840.113549.1.12.10.1.1', chaveCifrada: '1.2.840.113549.1.12.10.1.2', certificado: '1.2.840.113549.1.12.10.1.3' });

/**
 * `A1_CHAVE_NAO_RSA`: o PKCS#12 traz chave privada de outro algoritmo (EC, por exemplo); a NF-e só assina com RSA.
 * `A1_SEM_CNPJ`: o titular foi recusado por `cnpjDoTitularIcp` (SDK). O `ErroCertificado` original vai no `cause`, com
 * o código fino (`cnpj_ausente`, `dv_invalido`, `cnpj_divergente`); na SEFAZ, o mesmo caso é o 292.
 */
export type CodigoErroCertificadoA1 =
  | 'A1_ILEGIVEL'
  | 'A1_SEM_CHAVE'
  | 'A1_CHAVE_NAO_RSA'
  | 'A1_SEM_CERTIFICADO'
  | 'A1_FORA_DA_VALIDADE'
  | 'A1_SEM_CNPJ';

export class ErroCertificadoA1 extends Error {
  constructor(
    readonly codigo: CodigoErroCertificadoA1,
    opcoes?: { cause?: ErroCertificado },
  ) {
    // Mensagem fixa: nunca inclui senha, nome do titular ou conteúdo do arquivo.
    super(`Certificado A1 recusado: ${codigo}`, opcoes);
    this.name = 'ErroCertificadoA1';
  }
}

export interface CertificadoA1EmMemoria {
  /** Chave privada RSA em PEM (PKCS#8). */
  readonly chavePrivadaPem: string;
  /** Certificado do titular em PEM. */
  readonly certificadoPem: string;
  /** Certificado do titular em DER/base64, sem quebras (vai no `X509Certificate` da assinatura). */
  readonly certificadoBase64: string;
  /** Cadeia intermediária em PEM (para o mTLS), sem o certificado do titular. */
  readonly cadeiaPem: readonly string[];
  /** CNPJ do titular (SAN ICP-Brasil ou, de reserva, CN), pela função única do platform-sdk (`cnpjDoTitularIcp`, RD-0294). */
  readonly cnpj: string;
  /** SHA-256 do certificado (hex, minúsculas): a mesma impressão digital que o core grava. */
  readonly impressaoDigital: string;
  readonly validoDe: Date;
  readonly validoAte: Date;
}

const REDIGIDO = '[CertificadoA1 redigido]';

function protegido(dados: CertificadoA1EmMemoria): CertificadoA1EmMemoria {
  const alvo = { ...dados } as CertificadoA1EmMemoria & Record<string | symbol, unknown>;
  Object.defineProperty(alvo, 'toJSON', { value: () => REDIGIDO, enumerable: false });
  Object.defineProperty(alvo, inspect.custom, { value: () => REDIGIDO, enumerable: false });
  Object.defineProperty(alvo, 'toString', { value: () => REDIGIDO, enumerable: false });
  for (const k of ['chavePrivadaPem', 'certificadoPem', 'certificadoBase64', 'cadeiaPem'] as const) {
    Object.defineProperty(alvo, k, { value: dados[k], enumerable: false, writable: false });
  }
  return Object.freeze(alvo);
}

/**
 * Abre o PKCS#12 (bytes já decifrados) e devolve o material em memória.
 * `agora` só serve para conferir a validade (injetável nos testes).
 */
export function abrirA1(pfx: Uint8Array, senha: string, agora: Date = new Date()): CertificadoA1EmMemoria {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn = forge.asn1.fromDer(forge.util.binary.raw.encode(pfx));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, senha);
  } catch {
    throw new ErroCertificadoA1('A1_ILEGIVEL');
  }
  const chaves = [
    ...(p12.getBags({ bagType: BAG.chaveCifrada })[BAG.chaveCifrada] ?? []),
    ...(p12.getBags({ bagType: BAG.chave })[BAG.chave] ?? []),
  ];
  const chave = chaves.find((b) => b.key)?.key;
  // O forge só lê chave RSA: a de outro algoritmo vem com `key` nulo e o ASN.1 cru (que não vai para o erro).
  if (!chave) throw new ErroCertificadoA1(chaves.some((b) => b.asn1) ? 'A1_CHAVE_NAO_RSA' : 'A1_SEM_CHAVE');
  const certs = (p12.getBags({ bagType: BAG.certificado })[BAG.certificado] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));
  const publica = forge.pki.setRsaPublicKey((chave as forge.pki.rsa.PrivateKey).n, (chave as forge.pki.rsa.PrivateKey).e);
  const doTitular = certs.find((c) => forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(publica));
  if (!doTitular) throw new ErroCertificadoA1('A1_SEM_CERTIFICADO');
  if (agora < doTitular.validity.notBefore || agora > doTitular.validity.notAfter) throw new ErroCertificadoA1('A1_FORA_DA_VALIDADE');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(doTitular)).getBytes();
  const x509 = new X509Certificate(Buffer.from(der, 'binary'));
  let cnpj: string;
  try {
    cnpj = cnpjDoTitularIcp(x509).cnpj;
  } catch (e) {
    if (e instanceof ErroCertificado) throw new ErroCertificadoA1('A1_SEM_CNPJ', { cause: e });
    throw e;
  }
  return protegido({
    chavePrivadaPem: forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave))),
    certificadoPem: forge.pki.certificateToPem(doTitular),
    certificadoBase64: forge.util.encode64(der),
    cadeiaPem: certs.filter((c) => c !== doTitular).map((c) => forge.pki.certificateToPem(c)),
    cnpj,
    impressaoDigital: impressaoDigitalSha256(x509),
    validoDe: doTitular.validity.notBefore,
    validoAte: doTitular.validity.notAfter,
  });
}
