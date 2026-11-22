/**
 * T-0022, caso do corretor (RD-0294, encaminhamento ao `testes`): A1 FICTÍCIO com o CNPJ só no SAN
 * (`otherName` OID 2.16.76.1.3.3, como o ICP-Brasil grava o CNPJ do titular de e-CNPJ, DOC-ICP-04) e o titular SEM o
 * `:CNPJ` no CN. O `gerarA1DeTeste` da T-0045 só põe o CNPJ no CN, então o certificado é montado aqui, em DER, com o
 * `node:crypto` (sem dependência nova). Sai quando o `gerarA1DeTeste` ganhar a opção `cnpjNoSan` (engenheiro-software).
 *
 * Tudo na memória: nenhum `.pfx`/`.p12`/PEM vai ao disco nem ao log. Chave RSA nova a cada geração e senha aleatória.
 * Só para teste: o certificado é autoassinado e a SEFAZ real o recusaria.
 */
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// ---------- DER mínimo (X.690) ----------

function tamanho(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, conteudo: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), tamanho(conteudo.length), conteudo]);
const seq = (...xs: Buffer[]) => tlv(0x30, Buffer.concat(xs));
const set = (...xs: Buffer[]) => tlv(0x31, Buffer.concat(xs));
const octetos = (b: Buffer) => tlv(0x04, b);
const nulo = () => Buffer.from([0x05, 0x00]);
const explicito = (n: number, x: Buffer) => tlv(0xa0 + n, x);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const imprimivel = (s: string) => tlv(0x13, Buffer.from(s, 'ascii'));
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));

function inteiro(n: number | Buffer): Buffer {
  const hex = typeof n === 'number' ? n.toString(16) : '';
  let b = typeof n === 'number' ? Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex') : n;
  if ((b[0] ?? 0) & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(texto: string): Buffer {
  const [a = 0, b = 0, ...resto] = texto.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of resto) {
    const grupo = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) grupo.unshift((x & 0x7f) | 0x80);
    bytes.push(...grupo);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime (AAMMDDhhmmssZ): vale até 2049, o que basta para a validade do teste. */
const utcTime = (d: Date) => tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`, 'ascii'));

// ---------- OIDs ----------

const OID = {
  cn: '2.5.4.3',
  o: '2.5.4.10',
  c: '2.5.4.6',
  san: '2.5.29.17',
  sha256Rsa: '1.2.840.113549.1.1.11',
  sha256: '2.16.840.1.101.3.4.2.1',
  /** ICP-Brasil, pessoa jurídica: CNPJ do titular (DOC-ICP-04, item 7.1.2.3). */
  cnpjIcp: '2.16.76.1.3.3',
  dados: '1.2.840.113549.1.7.1',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509: '1.2.840.113549.1.9.22.1',
} as const;

// ---------- certificado ----------

interface OpcoesCertificadoSan {
  cnpj: string;
  nome: string;
  validoDe: Date;
  validoAte: Date;
  /** Onde o CNPJ aparece: só no SAN (o caso do corretor) ou também no CN (`NOME:CNPJ`, o controle). */
  cnpjNoCn: boolean;
}

interface A1ComSan {
  /** PKCS#12 (chave sem cifra, MAC HMAC-SHA256 com a senha), só na memória. */
  readonly pfx: Buffer;
  readonly senha: string;
  readonly certificadoPem: string;
  readonly chavePrivadaPem: string;
  /** O DER do certificado (para conferir que o OID do CNPJ está no SAN). */
  readonly certificadoDer: Buffer;
}

function nomeX500(cn: string): Buffer {
  const rdn = (tipo: string, valor: Buffer) => set(seq(oid(tipo), valor));
  return seq(rdn(OID.c, imprimivel('BR')), rdn(OID.o, utf8('ICP-Brasil (ficticio, so teste)')), rdn(OID.cn, utf8(cn)));
}

/** Conteúdo do `otherName` 2.16.76.1.3.3: o OID e o CNPJ em ASCII, num OCTET STRING. */
const otherNameCnpj = (cnpj: string): Buffer =>
  Buffer.concat([oid(OID.cnpjIcp), explicito(0, octetos(Buffer.from(cnpj, 'ascii')))]);

/** SAN com um `otherName` 2.16.76.1.3.3. */
const extensaoSan = (cnpj: string): Buffer => seq(oid(OID.san), octetos(seq(tlv(0xa0, otherNameCnpj(cnpj)))));

/** PKCS#12, RFC 7292, apêndice B.2: chave do MAC (ID 3) com SHA-256. */
function chaveMac(senha: string, sal: Buffer, iteracoes: number): Buffer {
  const v = 64;
  const bmp = Buffer.alloc((senha.length + 1) * 2);
  for (let i = 0; i < senha.length; i++) bmp.writeUInt16BE(senha.charCodeAt(i), i * 2);
  const repetir = (b: Buffer) => {
    const n = v * Math.ceil(b.length / v);
    const r = Buffer.alloc(n);
    for (let i = 0; i < n; i++) r[i] = b[i % b.length] ?? 0;
    return r;
  };
  let a = Buffer.concat([Buffer.alloc(v, 3), repetir(sal), repetir(bmp)]);
  for (let i = 0; i < iteracoes; i++) a = createHash('sha256').update(a).digest();
  return a;
}

function pkcs12(chavePkcs8: Buffer, certDer: Buffer, senha: string): Buffer {
  const bagChave = seq(oid(OID.keyBag), explicito(0, chavePkcs8));
  const bagCert = seq(oid(OID.certBag), explicito(0, seq(oid(OID.x509), explicito(0, octetos(certDer)))));
  const conteudo = (x: Buffer) => seq(oid(OID.dados), explicito(0, octetos(x)));
  const autenticado = seq(conteudo(seq(bagChave)), conteudo(seq(bagCert)));
  const sal = randomBytes(16);
  const iteracoes = 2048;
  const mac = createHmac('sha256', chaveMac(senha, sal, iteracoes)).update(autenticado).digest();
  const macData = seq(seq(seq(oid(OID.sha256), nulo()), octetos(mac)), octetos(sal), inteiro(iteracoes));
  return seq(inteiro(3), conteudo(autenticado), macData);
}

const pem = (rotulo: string, der: Buffer) =>
  `-----BEGIN ${rotulo}-----\n${(der.toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${rotulo}-----\n`;

/** Gera o A1 fictício com o CNPJ no SAN (e, se pedido, também no CN). */
export function gerarA1ComCnpjNoSan(o: OpcoesCertificadoSan): A1ComSan {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algoritmo = seq(oid(OID.sha256Rsa), nulo());
  const titular = nomeX500(o.cnpjNoCn ? `${o.nome}:${o.cnpj}` : o.nome);
  const tbs = seq(
    explicito(0, inteiro(2)),
    inteiro(Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
    algoritmo,
    titular,
    seq(utcTime(o.validoDe), utcTime(o.validoAte)),
    titular,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicito(3, seq(extensaoSan(o.cnpj))),
  );
  const certificadoDer = seq(tbs, algoritmo, bits(sign('sha256', tbs, privateKey)));
  const chavePkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const senha = randomBytes(18).toString('base64url');
  return Object.freeze({
    pfx: pkcs12(chavePkcs8, certificadoDer, senha),
    senha,
    certificadoPem: pem('CERTIFICATE', certificadoDer),
    chavePrivadaPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificadoDer,
  });
}

/** O DER do OID 2.16.76.1.3.3 seguido do CNPJ: a prova de que o CNPJ está mesmo no SAN do certificado gerado. */
export const sanTemCnpj = (certificadoDer: Buffer, cnpj: string): boolean => certificadoDer.includes(otherNameCnpj(cnpj));
