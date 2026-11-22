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

/**
 * Ambiente do serviço macuxierp-worker no compose.yml (URLs do Hub fixas e os dois interruptores em `ligado` desde a
 * virada, desenho T-0002 §2) mais a chave de integração do .env.
 */
export const envComposeWorker = (chave: string) => ({
  MACUXIERP_HUB_URL_PRODUCAO: 'https://api.macuxifdv.com.br/integracao/v1',
  MACUXIERP_HUB_URL_TESTE: 'https://hub-teste.invalid/integracao/v1',
  MACUXIERP_FDV_RECEBIMENTO: 'ligado',
  MACUXIERP_FDV_ENVIO: 'ligado',
  MACUXIERP_CHAVE_INTEGRACAO: chave,
});
