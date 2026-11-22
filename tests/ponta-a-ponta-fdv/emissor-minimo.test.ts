/**
 * T-0012: limites do emissor mínimo do arnês (`apoio/emissor-minimo.ts`), como os do SDK: o corpo da resposta do Hub é
 * lido só até 4 MiB e o `Retry-After` tem teto de 1 h. As contas são do próprio emissor (oráculo independente,
 * RD-0221); o servidor aqui é um HTTP local cru, sem o dublê.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredencialHub } from './apoio/config';
import { gerarChaveConector } from './apoio/duble-hub';
import {
  LIMITE_RESPOSTA_BYTES,
  RETRY_AFTER_TETO_MS,
  retryAfterMs,
  transporteFetch,
} from './apoio/emissor-minimo';
import { RelogioDeTeste } from './apoio/relogio';

const AGORA = new Date('2026-11-21T15:00:00.000Z');

describe('T-0012 — emissor mínimo: teto do Retry-After (1 h)', () => {
  it('segundos e data HTTP: até 1 h vale o pedido; acima, o teto; ilegível ou ausente, null', () => {
    const t = AGORA.getTime();
    expect(RETRY_AFTER_TETO_MS).toBe(3_600_000);
    expect(retryAfterMs('7', t)).toBe(7000);
    expect(retryAfterMs('3600', t)).toBe(3_600_000);
    expect(retryAfterMs('86400', t)).toBe(3_600_000);
    expect(retryAfterMs(new Date(t + 10_000).toUTCString(), t)).toBe(10_000);
    expect(retryAfterMs(new Date(t + 5 * 3_600_000).toUTCString(), t)).toBe(3_600_000);
    expect(retryAfterMs(new Date(t - 60_000).toUTCString(), t)).toBe(0);
    expect(retryAfterMs('daqui a pouco', t)).toBeNull();
    expect(retryAfterMs(null, t)).toBeNull();
  });
});

describe('T-0012 — emissor mínimo: corpo da resposta até 4 MiB', () => {
  let servidor: Server;
  let url: string;
  /** Resposta da próxima chamada: status, tamanho do corpo e se declara o `content-length`. */
  let proxima: { status: number; bytes: number; declara: boolean; retryAfter?: string };

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      req.resume();
      const corpo = Buffer.alloc(proxima.bytes, 0x20);
      const cab: Record<string, string> = { 'content-type': 'application/json' };
      if (proxima.declara) cab['content-length'] = String(corpo.byteLength);
      if (proxima.retryAfter) cab['retry-after'] = proxima.retryAfter;
      res.writeHead(proxima.status, cab);
      res.end(corpo);
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/integracao/v1`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  const chamar = () =>
    transporteFetch({
      url,
      credencial: new CredencialHub('erp-a', gerarChaveConector()),
      versaoErp: 'dev',
      relogio: new RelogioDeTeste(AGORA),
    }).chamar('GET', '/cursores/filial');

  it('até 4 MiB o corpo é lido; acima, com ou sem content-length, sai resposta_grande sem ler o resto', async () => {
    proxima = { status: 200, bytes: LIMITE_RESPOSTA_BYTES, declara: true };
    expect(await chamar()).toMatchObject({ tipo: 'ok', status: 200 });
    for (const declara of [true, false]) {
      proxima = { status: 200, bytes: LIMITE_RESPOSTA_BYTES + 1, declara };
      expect(await chamar()).toEqual({ tipo: 'recusa', status: 200, codigo: 'resposta_grande' });
    }
  });

  it('429 e 5xx grandes continuam retentáveis (resposta_grande), com o Retry-After no teto de 1 h', async () => {
    proxima = { status: 503, bytes: LIMITE_RESPOSTA_BYTES + 1, declara: false, retryAfter: '7200' };
    expect(await chamar()).toEqual({
      tipo: 'retentar',
      status: 503,
      codigo: 'resposta_grande',
      retryAfterMs: RETRY_AFTER_TETO_MS,
    });
    proxima = { status: 429, bytes: 0, declara: true, retryAfter: '86400' };
    expect(await chamar()).toEqual({
      tipo: 'retentar',
      status: 429,
      codigo: null,
      retryAfterMs: RETRY_AFTER_TETO_MS,
    });
  });
});
