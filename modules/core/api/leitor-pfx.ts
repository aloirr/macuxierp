/**
 * Abre o `.pfx` do A1 sem biblioteca nova: o Node não expõe o PKCS#12, mas um servidor TLS local aceita `pfx` +
 * `passphrase` (senha errada ou arquivo corrompido falham aqui) e o cliente lê o certificado do servidor. A conexão é
 * em loopback (127.0.0.1, porta efêmera), dura milissegundos e nada sai da máquina. A senha e o arquivo ficam só na
 * memória deste processo; erro nenhum os repete (regra 9).
 */
import { X509Certificate } from 'node:crypto';
import { createServer, connect } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { cnpjValido, normalizarDocumento } from '@macuxierp/platform-sdk';
import { PfxInvalido, type DadosPfx, type LeitorPfx } from './portas';

/** CNPJ do titular: o ICP-Brasil grava `NOME:<14 caracteres>` no CN do certificado de pessoa jurídica. */
export function cnpjDoSujeito(sujeito: string): string | null {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(sujeito)?.[1] ?? '';
  const candidatos = [...cn.matchAll(/(?:^|[:\s])([0-9A-Z]{12}[0-9]{2})(?=$|[\s,])/g)].map((m) => normalizarDocumento(m[1] ?? ''));
  return candidatos.find(cnpjValido) ?? null;
}

function titularDe(sujeito: string): string {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(sujeito)?.[1] ?? '';
  return cn.replace(/:[0-9A-Z]{14}$/, '').trim();
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
    const cnpj = cnpjDoSujeito(x.subject);
    if (!cnpj) throw new PfxInvalido('Certificado sem CNPJ no titular');
    return {
      titular: titularDe(x.subject),
      cnpj,
      valido_de: new Date(x.validFrom),
      valido_ate: new Date(x.validTo),
      impressao_digital: x.fingerprint256.replace(/:/g, '').toLowerCase(),
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
