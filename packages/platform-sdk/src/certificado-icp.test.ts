/**
 * Titular do certificado ICP-Brasil (RD-0294, RN-CAD-01 para o DV do CNPJ): o CNPJ vem do SAN `otherName`
 * 2.16.76.1.3.3, o CN `NOME:CNPJ` é a reserva, SAN e CN diferentes são recusados; nunca devolve null.
 *
 * Os certificados são gerados aqui, em tempo de execução, com o `node-forge` (devDependency): o gerador de A1 do
 * `@macuxierp/nfe-sefaz/teste` não serve, porque o nfe-sefaz depende do SDK (ciclo no grafo do turbo).
 * Nada em disco, nenhum A1 real.
 */
import { X509Certificate, createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { ErroCertificado, OID_CNPJ_ICP_BRASIL, cnpjDoTitularIcp, impressaoDigitalSha256, type CodigoErroCertificado } from './certificado-icp';
import { cnpjValido } from './documentos';

const CNPJ = '11222333000181';
const OUTRO = '11444777000161';
/** Exemplo de CNPJ alfanumérico da Receita Federal (DV válido). */
const ALFANUMERICO = '12ABC34501DE35';
const DV_ERRADO = '11222333000182';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
const publica = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());

interface Titular {
  /** CN completo (ex.: `EMPRESA:11222333000181`). */
  cn: string;
  /** Valor do `otherName` 2.16.76.1.3.3 no SAN; ausente = sem esse `otherName`. */
  san?: string;
  /** Outro `otherName` ICP-Brasil (2.16.76.1.3.4, dados do responsável) antes do CNPJ, e um dNSName. */
  sanComOutros?: boolean;
}

function sanExtensao(t: Titular): { id: string; value: string } {
  const a = forge.asn1;
  const otherName = (oid: string, valor: string) =>
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [
      a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(oid).getBytes()),
      a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, valor)]),
    ]);
  const nomes = [
    ...(t.sanComOutros ? [a.create(a.Class.CONTEXT_SPECIFIC, 2, false, 'ficticio.exemplo'), otherName('2.16.76.1.3.4', '0'.repeat(30))] : []),
    ...(t.san !== undefined ? [otherName(OID_CNPJ_ICP_BRASIL, t.san)] : []),
  ];
  return { id: '2.5.29.17', value: a.toDer(a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, nomes)).getBytes() };
}

function certificado(t: Titular): X509Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = new Date('2025-11-22T00:00:00Z');
  cert.validity.notAfter = new Date('2027-11-22T00:00:00Z');
  const sujeito = [
    { name: 'commonName', value: t.cn },
    { name: 'organizationName', value: 'ICP-Brasil (ficticio, so teste)' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(sujeito);
  cert.setIssuer(sujeito);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    ...(t.san !== undefined || t.sanComOutros ? [sanExtensao(t)] : []),
  ]);
  cert.sign(chave, forge.md.sha256.create());
  return new X509Certificate(forge.pki.certificateToPem(cert));
}

function recusa(t: Titular): CodigoErroCertificado {
  const cert = certificado(t);
  try {
    cnpjDoTitularIcp(cert);
  } catch (e) {
    expect(e).toBeInstanceOf(ErroCertificado);
    const erro = e as ErroCertificado;
    expect(erro.name).toBe('ErroCertificado');
    // A mensagem é fixa: nada do certificado (nem o CNPJ, nem o PEM, nem a impressão digital).
    for (const vazado of [CNPJ, OUTRO, ALFANUMERICO, DV_ERRADO, 'EMPRESA', 'MIIB', impressaoDigitalSha256(cert)]) expect(erro.message).not.toContain(vazado);
    return erro.codigo;
  }
  throw new Error('esperava ErroCertificado');
}

describe('cnpjDoTitularIcp (RD-0294)', () => {
  it('pré-condição: os CNPJs de teste têm o DV que o teste diz (RN-CAD-01)', () => {
    expect([CNPJ, OUTRO, ALFANUMERICO].every((c) => cnpjValido(c))).toBe(true);
    expect(cnpjValido(DV_ERRADO)).toBe(false);
  });

  it('regra 1: lê o CNPJ do SAN otherName 2.16.76.1.3.3, mesmo sem o :CNPJ no CN', () => {
    expect(cnpjDoTitularIcp(certificado({ cn: 'EMPRESA FICTICIA LTDA', san: OUTRO }))).toEqual({ cnpj: OUTRO, origem: 'san' });
  });

  it('regra 1: acha o 2.16.76.1.3.3 entre outros nomes do SAN (dNSName, 2.16.76.1.3.4)', () => {
    expect(cnpjDoTitularIcp(certificado({ cn: 'EMPRESA', san: CNPJ, sanComOutros: true }))).toEqual({ cnpj: CNPJ, origem: 'san' });
  });

  it('regra 2: sem o otherName do CNPJ no SAN, o CN NOME:CNPJ é a reserva', () => {
    expect(cnpjDoTitularIcp(certificado({ cn: `EMPRESA FICTICIA LTDA:${CNPJ}` }))).toEqual({ cnpj: CNPJ, origem: 'cn' });
    expect(cnpjDoTitularIcp(certificado({ cn: `EMPRESA:${CNPJ}`, sanComOutros: true }))).toEqual({ cnpj: CNPJ, origem: 'cn' });
  });

  it('o mesmo CNPJ no SAN e no CN passa, com origem no SAN', () => {
    expect(cnpjDoTitularIcp(certificado({ cn: `EMPRESA:${CNPJ}`, san: CNPJ }))).toEqual({ cnpj: CNPJ, origem: 'san' });
  });

  it('regra 3: SAN e CN com CNPJs diferentes = cnpj_divergente', () => {
    expect(recusa({ cn: `EMPRESA:${OUTRO}`, san: CNPJ })).toBe('cnpj_divergente');
  });

  it('CNPJ alfanumérico (Receita, jul/2026) no SAN e no CN, com DV conferido', () => {
    expect(cnpjDoTitularIcp(certificado({ cn: 'EMPRESA', san: ALFANUMERICO }))).toEqual({ cnpj: ALFANUMERICO, origem: 'san' });
    expect(cnpjDoTitularIcp(certificado({ cn: `EMPRESA:${ALFANUMERICO}` }))).toEqual({ cnpj: ALFANUMERICO, origem: 'cn' });
    expect(cnpjDoTitularIcp(certificado({ cn: `EMPRESA:${ALFANUMERICO}`, san: ALFANUMERICO }))).toEqual({ cnpj: ALFANUMERICO, origem: 'san' });
    expect(recusa({ cn: 'EMPRESA', san: '12ABC34501DE36' })).toBe('dv_invalido');
  });

  it('DV inválido no SAN ou no CN = dv_invalido (não cai para a outra fonte)', () => {
    expect(recusa({ cn: 'EMPRESA', san: DV_ERRADO })).toBe('dv_invalido');
    expect(recusa({ cn: `EMPRESA:${DV_ERRADO}` })).toBe('dv_invalido');
    expect(recusa({ cn: `EMPRESA:${CNPJ}`, san: DV_ERRADO })).toBe('dv_invalido');
    expect(recusa({ cn: `EMPRESA:${DV_ERRADO}`, san: CNPJ })).toBe('dv_invalido');
    expect(recusa({ cn: 'EMPRESA', san: 'ABC' })).toBe('dv_invalido');
  });

  it('sem CNPJ no SAN nem no CN = cnpj_ausente (nunca null)', () => {
    expect(recusa({ cn: 'EMPRESA FICTICIA LTDA' })).toBe('cnpj_ausente');
    expect(recusa({ cn: 'FULANO DE TAL:12345678909' })).toBe('cnpj_ausente');
    expect(recusa({ cn: 'EMPRESA', sanComOutros: true })).toBe('cnpj_ausente');
  });
});

describe('impressaoDigitalSha256', () => {
  it('SHA-256 do DER, hex minúsculo sem ":" (o formato que o core grava)', () => {
    const cert = certificado({ cn: `EMPRESA:${CNPJ}` });
    const esperado = createHash('sha256').update(cert.raw).digest('hex');
    expect(impressaoDigitalSha256(cert)).toBe(esperado);
    expect(impressaoDigitalSha256(cert)).toBe(cert.fingerprint256.replace(/:/g, '').toLowerCase());
  });
});

describe('ErroCertificado', () => {
  it('código tipado e mensagem fixa por código', () => {
    const e = new ErroCertificado('cnpj_ausente');
    expect(e).toBeInstanceOf(Error);
    expect(e.codigo).toBe('cnpj_ausente');
    expect(e.message).toBe(new ErroCertificado('cnpj_ausente').message);
    expect(new ErroCertificado('dv_invalido').message).not.toBe(e.message);
  });
});
