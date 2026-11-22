/**
 * Apoio dos testes do worker: o pino real escrevendo num destino em memória, para conferir o formato JSON do log e que
 * nenhum dado pessoal chega a ele (regra 8).
 */
import { Writable } from 'node:stream';
import { pino } from 'pino';

export function pinoEmMemoria() {
  const linhas: string[] = [];
  const log = pino({ level: 'info' }, new Writable({ write: (c, _e, cb) => (linhas.push(String(c)), cb()) }));
  return { log, linhas, registros: () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>) };
}
