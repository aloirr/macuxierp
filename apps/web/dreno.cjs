'use strict';
// Preload do dreno (v0.3.25): node --require ./apps/web/dreno.cjs apps/web/server.js
// Contrato igual ao da api: x-macuxierp-instancia em toda resposta; SIGUSR2 liga o dreno
// (Connection: close + fecha keep-alive ocioso agora e a cada 1 s por 30 s). SIGTERM fica com o Next.
const http = require('node:http');
const https = require('node:https');
const { randomBytes } = require('node:crypto');

const instancia = randomBytes(4).toString('hex');
const servidores = new Set();
let drenando = false;
let temporizador = null;

function fecharOciosas() {
  for (const s of servidores) {
    if (typeof s.closeIdleConnections === 'function') s.closeIdleConnections();
  }
}

function iniciarDreno() {
  if (drenando) return;
  drenando = true;
  console.log(`[dreno] instancia ${instancia}: SIGUSR2 recebido, Connection: close e keep-alive ocioso fechado`);
  fecharOciosas();
  let n = 0;
  temporizador = setInterval(() => {
    fecharOciosas();
    if (++n >= 30) clearInterval(temporizador);
  }, 1000);
  temporizador.unref();
}

function instrumentar(servidor) {
  if (servidores.has(servidor)) return servidor;
  servidores.add(servidor);
  servidor.on('close', () => servidores.delete(servidor));
  servidor.prependListener('request', (_req, res) => {
    res.setHeader('x-macuxierp-instancia', instancia);
    if (drenando) res.setHeader('Connection', 'close');
  });
  return servidor;
}

for (const modulo of [http, https]) {
  const original = modulo.createServer;
  modulo.createServer = function createServer(...args) {
    return instrumentar(original.apply(this, args));
  };
}

process.on('SIGUSR2', iniciarDreno);
