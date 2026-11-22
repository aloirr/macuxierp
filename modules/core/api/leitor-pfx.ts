/**
 * Abre o `.pfx` do A1 sem biblioteca nova: o Node não expõe o PKCS#12, mas um servidor TLS local aceita `pfx` +
 * `passphrase` (senha errada ou arquivo corrompido falham aqui) e o cliente lê o certificado do servidor. A conexão é
 * em loopback (127.0.0.1, porta efêmera), dura milissegundos e nada sai da máquina. A senha e o arquivo ficam só na
 * memória deste processo; erro nenhum os repete (regra 9).
 */
import { X509Certificate } from 'node:crypto';
import { createServer, connect } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { cnpjDoTitularIcp, impressaoDigitalSha256 } from '@macuxierp/platform-sdk';
import { PfxInvalido, type DadosPfx, type LeitorPfx } from './portas';

// Só o nome do titular, sem regra de CNPJ (a regra é do SDK): corta o sufixo `:CNPJ` na mesma forma do `valorNoCn`.
function titularDe(sujeito: string): string {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(sujeito)?.[1] ?? '';
  return cn.replace(/:[0-9A-Za-z]{12}\d{2}\s*$/, '').trim();
}

export class LeitorPfxTls implements LeitorPfx {
  async abrir(pfx: Buffer, senha: string): Promise<DadosPfx> {
    let raw: Buffer;
    try {
      raw = await this.certificadoDoServidor(pfx, senha);
    } catch {
      throw new PfxInvalido('Não foi possível abrir o .pfx');
    }
    const x = new X509Certificate(raw);
    // CNPJ pela regra do SDK; `ErroCertificado` sobe sem conversão (ver portas.ts).
    const { cnpj } = cnpjDoTitularIcp(x);
    return {
      titular: titularDe(x.subject),
      cnpj,
      valido_de: new Date(x.validFrom),
      valido_ate: new Date(x.validTo),
      impressao_digital: impressaoDigitalSha256(x),
    };
  }

  private certificadoDoServidor(pfx: Buffer, senha: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const servidor = createServer({ pfx, passphrase: senha }, (s) => s.end()); // lança se a senha não abre
      servidor.on('error', reject);
      servidor.listen(0, '127.0.0.1', () => {
        const porta = (servidor.address() as AddressInfo).port;
        const cliente = connect({ host: '127.0.0.1', port: porta, rejectUnauthorized: false }, () => {
          const cert = cliente.getPeerCertificate();
          cliente.end();
          servidor.close();
          if (cert.raw) resolve(cert.raw);
          else reject(new Error('sem certificado'));
        });
        cliente.on('error', (e) => {
          servidor.close();
          reject(e);
        });
      });
    });
  }
}
