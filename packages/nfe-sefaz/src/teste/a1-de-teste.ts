/**
 * A1 DE TESTE (ADR 0005 e ADR 0008): par RSA e X.509 autoassinado de uma empresa FICTÍCIA, empacotado em PKCS#12 com
 * senha aleatória, tudo na memória. Nenhum `.pfx`/`.p12` entra no repositório (`.gitignore`) nem vai ao disco.
 * O titular segue o ICP-Brasil: o CNPJ vai no CN (`CN=<NOME>:<CNPJ>`, padrão), no SAN (`otherName` 2.16.76.1.3.3) ou
 * nos dois (`cnpjNoTitular`), para provar a leitura de `cnpjDoTitularIcp` (platform-sdk) nos dois lugares; com `cnpjNoCn`,
 * o CN leva outro CNPJ que o SAN (o caso recusado como `cnpj_divergente`).
 * Só para testes: o certificado não tem cadeia ICP-Brasil e a SEFAZ real o recusaria (283/293).
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import { OID_CNPJ_ICP_BRASIL } from '@macuxierp/platform-sdk';

/** CNPJs fictícios com DV válido, de uso corrente em exemplos (não pertencem a empresa do piloto). */
export const CNPJ_EMITENTE_DE_TESTE = '11222333000181';
export const CNPJ_OUTRO_DE_TESTE = '11444777000161';

/** Instante fixo dos testes: 21/11/2026, 22h59 em Manaus (o instante da decisão da ADR 0008). */
export const INSTANTE_DE_TESTE: Date = new Date('2026-11-22T02:59:00Z');

/** Validade dos A1 dos testes com relógio fixo: um ano antes e um ano depois do `INSTANTE_DE_TESTE`. */
export const VALIDADE_DE_TESTE: Readonly<{ validoDe: Date; validoAte: Date }> = Object.freeze({
  validoDe: new Date('2025-11-22T00:00:00Z'),
  validoAte: new Date('2027-11-22T00:00:00Z'),
});

export interface OpcoesA1DeTeste {
  cnpj?: string;
  /** Razão social no titular (sem acento, como o ICP-Brasil grava). */
  nome?: string;
  validoDe?: Date;
  validoAte?: Date;
  /** Titular sem CNPJ no CN nem no SAN (para o teste do 292). */
  semCnpj?: boolean;
  /** Onde vai o CNPJ: só no CN (padrão), só no SAN ICP-Brasil ou nos dois. */
  cnpjNoTitular?: 'cn' | 'san' | 'cn-e-san';
  /**
   * CNPJ explícito do CN (`CN=<NOME>:<cnpjNoCn>`), para o teste de SAN ≠ CN: com ele o CN sempre leva um CNPJ e o
   * `cnpj` vai só no SAN (`cnpjNoTitular` é ignorado). Não combina com `semCnpj`.
   */
  cnpjNoCn?: string;
}

/** Extensão SAN com o `otherName` 2.16.76.1.3.3 (o forge não escreve `otherName`: montado em ASN.1). */
function sanComCnpj(cnpj: string): { id: string; value: string } {
  const a = forge.asn1;
  const otherName = a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [
    a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(OID_CNPJ_ICP_BRASIL).getBytes()),
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, cnpj)]),
  ]);
  return { id: '2.5.29.17', value: a.toDer(a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [otherName])).getBytes() };
}

export interface A1DeTeste {
  /** O `.pfx` (PKCS#12, 3DES/SHA-1, como os A1 do mercado), só na memória. */
  readonly pfx: Buffer;
  /** Senha aleatória de 24 caracteres; muda a cada geração. */
  readonly senha: string;
  readonly cnpj: string;
  readonly certificadoPem: string;
  /** A chave privada (PEM), só na memória, como o `pfx`: é o que a assinatura de teste usa. */
  readonly chavePrivadaPem: string;
}

/**
 * Gera um A1 fictício. Usa a chave RSA do `node:crypto` (rápida) e o `node-forge` para o X.509 e o PKCS#12
 * (o Node não monta PKCS#12; ADR 0008).
 */
export function gerarA1DeTeste(o: OpcoesA1DeTeste = {}): A1DeTeste {
  const cnpj = o.cnpj ?? CNPJ_EMITENTE_DE_TESTE;
  const nome = o.nome ?? 'EMPRESA FICTICIA DE TESTE LTDA';
  // hora-fixa-ok: padrão só quando o teste não fixa; a validade é larga (um ano para cada lado)
  const validoDe = o.validoDe ?? new Date(Date.now() - 365 * 86_400_000);
  const validoAte = o.validoAte ?? new Date(Date.now() + 365 * 86_400_000);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const publica = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());

  const cert = forge.pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = validoDe;
  cert.validity.notAfter = validoAte;
  if (o.semCnpj && o.cnpjNoCn !== undefined) throw new RangeError('gerarA1DeTeste: semCnpj e cnpjNoCn não combinam');
  const onde = o.semCnpj ? null : o.cnpjNoCn !== undefined ? 'san' : (o.cnpjNoTitular ?? 'cn');
  const cn = o.cnpjNoCn !== undefined ? `${nome}:${o.cnpjNoCn}` : onde === 'cn' || onde === 'cn-e-san' ? `${nome}:${cnpj}` : nome;
  const sujeito = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'ICP-Brasil (ficticio, so teste)' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(sujeito);
  cert.setIssuer(sujeito);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    ...(onde === 'san' || onde === 'cn-e-san' ? [sanComCnpj(cnpj)] : []),
  ]);
  cert.sign(chave, forge.md.sha256.create());

  const senha = randomBytes(18).toString('base64url');
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, [cert], senha, { algorithm: '3des', friendlyName: 'a1-de-teste' });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
  const chavePrivadaPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return Object.freeze({ pfx, senha, cnpj, certificadoPem: forge.pki.certificateToPem(cert), chavePrivadaPem });
}
