import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { Writable } from 'node:stream';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, IdempotenciaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { criarApp } from './app';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE, modulosDeTeste } from './apoio-teste';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { CABECALHO_INSTANCIA, INSTANCIA } from './dreno';

const abertos: { app: FastifyInstance; agente: http.Agent }[] = [];
afterEach(async () => {
  for (const { app, agente } of abertos.splice(0)) {
    agente.destroy();
    await app.close();
  }
});

async function subir(logs?: string[]) {
  const app = await criarApp({
    versao: '0.3.25',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: JWT_SEGREDO_DE_TESTE, argon2: ARGON2_RAPIDO },
    cookieSeguro: true,
    banco: new BancoMemoria(),
    repoAuth: new RepositorioAuthMemoria(),
    licencas: { ler: async () => [] },
    outbox: new OutboxMemoria(),
    auditoria: new AuditoriaMemoria(),
    trabalhos: new FilaDeTrabalhosMemoria(),
    relogio: new RelogioFixo(new Date('2026-11-27T15:00:00Z')),
    idempotencia: new IdempotenciaMemoria(),
    modulos: modulosDeTeste(),
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const agente = new http.Agent({ keepAlive: true, maxSockets: 1 });
  abertos.push({ app, agente });
  const porta = (app.server.address() as AddressInfo).port;
  return { app, agente, porta };
}

interface Resposta {
  status: number;
  headers: http.IncomingHttpHeaders;
  socket: Socket;
  reutilizou: boolean;
}

function pedir(porta: number, agente: http.Agent, caminho = '/v1/saude'): Promise<Resposta> {
  return new Promise((ok, falha) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: caminho, agent: agente }, (res) => {
      res.resume();
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, socket: req.socket as Socket, reutilizou: req.reusedSocket }));
    });
    req.on('error', falha);
  });
}

/** Espera o agente devolver o socket ao pool (ocioso no servidor). */
const tique = () => new Promise((r) => setTimeout(r, 20));

describe('dreno da troca sem parada (SIGUSR2)', () => {
  it('antes do dreno: x-macuxierp-instancia em toda resposta (8 hex, o mesmo id) e a conexão keep-alive é reutilizada', async () => {
    const { agente, porta } = await subir();
    const a = await pedir(porta, agente);
    await tique();
    const b = await pedir(porta, agente, '/nao-existe');
    expect(a.status).toBe(200);
    expect(b.status).toBe(404);
    expect(a.headers[CABECALHO_INSTANCIA]).toMatch(/^[0-9a-f]{8}$/);
    expect(a.headers[CABECALHO_INSTANCIA]).toBe(INSTANCIA);
    expect(b.headers[CABECALHO_INSTANCIA]).toBe(INSTANCIA);
    expect(a.headers.connection).toBe('keep-alive');
    expect(b.reutilizou).toBe(true);
    expect(b.socket).toBe(a.socket);
  });

  it('depois do dreno: a ociosa é fechada pelo servidor, a resposta traz connection: close e /v1/saude segue 200', async () => {
    const { app, agente, porta } = await subir();
    const a = await pedir(porta, agente);
    await tique();
    const fechou = new Promise<void>((r) => a.socket.once('close', () => r()));
    app.dreno.entrarEmDreno();
    await fechou;
    expect(app.dreno.emDreno()).toBe(true);

    const b = await pedir(porta, agente);
    expect(b.status).toBe(200);
    expect(b.reutilizou).toBe(false);
    expect(b.headers.connection).toBe('close');
    expect(b.headers[CABECALHO_INSTANCIA]).toBe(INSTANCIA);
    const c = await pedir(porta, agente, '/nao-existe');
    expect(c.status).toBe(404);
    expect(c.headers.connection).toBe('close');
  });

  it('é idempotente e loga o evento uma vez só, sem dado pessoal', async () => {
    const logs: string[] = [];
    const { app } = await subir(logs);
    app.dreno.entrarEmDreno();
    app.dreno.entrarEmDreno();
    const dreno = logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === 'dreno');
    expect(dreno).toHaveLength(1);
    expect(dreno[0]).toMatchObject({ modulo: 'plataforma', evento: 'dreno' });
  });
});
