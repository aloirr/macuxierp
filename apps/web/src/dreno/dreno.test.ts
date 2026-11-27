// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const preload = fileURLToPath(new URL('../../dreno.cjs', import.meta.url));
const dockerfile = readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8');

const servidorFalso = `
const http = require('node:http');
const s = http.createServer((req, res) => { res.end('ok'); });
s.listen(0, '127.0.0.1', () => console.log('PORTA ' + s.address().port));
`;

let filho: ChildProcess | undefined;
afterEach(() => {
  filho?.kill('SIGKILL');
  filho = undefined;
});

function subir(): Promise<number> {
  const proc = spawn(process.execPath, ['--require', preload, '-e', servidorFalso], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  filho = proc;
  return new Promise((resolve, reject) => {
    proc.stdout!.on('data', (d: Buffer) => {
      const m = /PORTA (\d+)/.exec(d.toString());
      if (m) resolve(Number(m[1]));
    });
    proc.once('exit', () => reject(new Error('filho saiu')));
  });
}

function pedir(agent: http.Agent, port: number) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; porta: number | undefined }>(
    (resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, agent }, (res) => {
        res.resume();
        const porta = res.socket.localPort;
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, porta }));
      });
      req.on('error', reject);
    },
  );
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('dreno do web (SIGUSR2)', () => {
  it('marca a instância, reaproveita a conexão e, no SIGUSR2, fecha o keep-alive e responde Connection: close', async () => {
    const port = await subir();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    let fechou = false;
    const a = await pedir(agent, port);
    const livres = (agent as unknown as { freeSockets: Record<string, Socket[]> }).freeSockets;
    const ocioso = Object.values(livres).flat()[0]!;
    ocioso.on('close', () => (fechou = true));
    const b = await pedir(agent, port);
    expect(a.status).toBe(200);
    expect(a.headers['x-macuxierp-instancia']).toMatch(/^[0-9a-f]{8}$/);
    expect(b.headers['x-macuxierp-instancia']).toBe(a.headers['x-macuxierp-instancia']);
    expect(b.headers.connection).toBe('keep-alive');
    expect(b.porta).toBe(a.porta);
    expect(fechou).toBe(false);

    process.kill(filho!.pid!, 'SIGUSR2');
    for (let i = 0; i < 30 && !fechou; i++) await esperar(100);
    expect(fechou).toBe(true);

    const c = await pedir(agent, port);
    expect(c.status).toBe(200);
    expect(c.headers.connection).toBe('close');
    expect(c.headers['x-macuxierp-instancia']).toBe(a.headers['x-macuxierp-instancia']);
    agent.destroy();
  });

  it('o Dockerfile copia o preload e o carrega no CMD', () => {
    expect(dockerfile).toMatch(/COPY .*\/app\/apps\/web\/dreno\.cjs \.\/apps\/web\/dreno\.cjs/);
    expect(dockerfile).toContain('CMD ["node", "--require", "./apps/web/dreno.cjs", "apps/web/server.js"]');
  });
});
