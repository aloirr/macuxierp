/**
 * Certificado de SERVIDOR TLS de teste (o A1 de teste é o do `@macuxierp/nfe-sefaz/teste`): par RSA e X.509
 * autoassinado para o host pedido, só em memória. Serve ao servidor HTTPS local que faz as vezes do autorizador nos
 * testes do transporte SOAP com mTLS. Nada vai a disco, log ou snapshot.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Agent } from 'node:https';
import { connect, type TLSSocket } from 'node:tls';
import forge from 'node-forge';
import { VALIDADE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';

export function gerarServidorTlsDeTeste(host: string): { chavePem: string; certificadoPem: string } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const chavePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const chave = forge.pki.privateKeyFromPem(chavePem) as forge.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(chave.n, chave.e);
  cert.serialNumber = `02${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = VALIDADE_DE_TESTE.validoDe;
  cert.validity.notAfter = VALIDADE_DE_TESTE.validoAte;
  const nome = [{ name: 'commonName', value: host }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
  ]);
  cert.sign(chave, forge.md.sha256.create());
  return { chavePem, certificadoPem: forge.pki.certificateToPem(cert) };
}

/**
 * Agente HTTPS que leva TODA conexão a `127.0.0.1:porta`, sem rede real: a URL do destino, o SNI (`servername`, se
 * dado) e a conferência do certificado continuam os do pedido.
 */
export function agenteParaLocal(porta: number, servername?: string): Agent {
  const agente = new Agent({ keepAlive: false });
  (agente as unknown as { createConnection: (o: object) => TLSSocket }).createConnection = (o) =>
    connect({ ...o, host: '127.0.0.1', port: porta, ...(servername === undefined ? {} : { servername }) });
  return agente;
}
