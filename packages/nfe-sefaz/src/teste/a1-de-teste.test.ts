/** A1 de teste (ADR 0005/0008): PKCS#12 que o OpenSSL do Node abre, senha aleatória, CNPJ no titular, nada em disco. */
import { X509Certificate, createPublicKey } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { cnpjDoTitularIcp } from '@macuxierp/platform-sdk';
import { CNPJ_EMITENTE_DE_TESTE, CNPJ_OUTRO_DE_TESTE, gerarA1DeTeste } from './a1-de-teste';

describe('gerarA1DeTeste', () => {
  it('gera PKCS#12 que o TLS do Node abre com a senha (o mesmo caminho do leitor do core) e recusa sem ela', () => {
    const a1 = gerarA1DeTeste({ cnpj: CNPJ_OUTRO_DE_TESTE });
    expect(() => createSecureContext({ pfx: a1.pfx, passphrase: a1.senha })).not.toThrow();
    expect(() => createSecureContext({ pfx: a1.pfx, passphrase: `${a1.senha}x` })).toThrow();
    const cert = new X509Certificate(a1.certificadoPem);
    expect(cnpjDoTitularIcp(cert)).toEqual({ cnpj: CNPJ_OUTRO_DE_TESTE, origem: 'cn' });
    // a chave privada devolvida é a do certificado (a mesma que foi para o PKCS#12)
    const spki = (k: Parameters<typeof createPublicKey>[0]) => createPublicKey(k).export({ type: 'spki', format: 'der' }).toString('hex');
    expect(spki(a1.chavePrivadaPem)).toBe(spki(a1.certificadoPem));
  });

  it('senha aleatória a cada geração e validade pedida', () => {
    const validoAte = new Date('2027-01-31T00:00:00Z');
    const a = gerarA1DeTeste({ validoDe: new Date('2026-01-01T00:00:00Z'), validoAte });
    const b = gerarA1DeTeste({ validoDe: new Date('2026-01-01T00:00:00Z'), validoAte });
    expect(a.senha).not.toBe(b.senha);
    expect(a.senha.length).toBeGreaterThanOrEqual(24);
    expect(new Date(new X509Certificate(a.certificadoPem).validTo).getTime()).toBe(validoAte.getTime());
  });

  it('cnpjNoTitular põe o CNPJ no CN, no SAN ou nos dois; cnpjNoCn grava outro CNPJ no CN (RD-0294)', () => {
    const titular = (o: Parameters<typeof gerarA1DeTeste>[0]) => new X509Certificate(gerarA1DeTeste(o).certificadoPem);
    const soSan = titular({ cnpj: CNPJ_OUTRO_DE_TESTE, cnpjNoTitular: 'san' });
    expect(soSan.subject).not.toContain(CNPJ_OUTRO_DE_TESTE);
    expect(cnpjDoTitularIcp(soSan)).toEqual({ cnpj: CNPJ_OUTRO_DE_TESTE, origem: 'san' });
    expect(cnpjDoTitularIcp(titular({ cnpjNoTitular: 'cn-e-san' }))).toEqual({ cnpj: CNPJ_EMITENTE_DE_TESTE, origem: 'san' });
    // Onde o CNPJ foi gravado; a recusa (SAN ≠ CN, sem CNPJ) é provada no SDK (certificado-icp.test.ts, RD-0256).
    const divergente = titular({ cnpj: CNPJ_EMITENTE_DE_TESTE, cnpjNoCn: CNPJ_OUTRO_DE_TESTE });
    expect(divergente.subject).toContain(`:${CNPJ_OUTRO_DE_TESTE}`);
    expect(divergente.subjectAltName).toBeDefined();
    expect(titular({ semCnpj: true }).subject).not.toMatch(/:\d{14}/);
    expect(() => gerarA1DeTeste({ semCnpj: true, cnpjNoCn: CNPJ_OUTRO_DE_TESTE })).toThrow(RangeError);
  });
});
