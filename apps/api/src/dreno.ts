/**
 * Dreno da troca sem parada (v0.3.25, scripts/deploy/producao/troca.sh): antes de a réplica velha sair do túnel, o
 * deploy manda SIGUSR2 e ela passa a responder com `Connection: close` e a fechar as conexões keep-alive ociosas, para o
 * cloudflared não ficar preso numa conexão sem RST depois do `docker network disconnect`. O processo segue atendendo
 * (inclusive /v1/saude 200); o SIGTERM continua sendo o encerramento (main.ts).
 *
 * Toda resposta leva `x-macuxierp-instancia`: 8 hex aleatórios da partida do processo (sem hostname nem id de contêiner),
 * para o deploy saber qual réplica respondeu.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const CABECALHO_INSTANCIA = 'x-macuxierp-instancia';
/** Id desta instância do processo, gerado uma vez na partida. */
export const INSTANCIA = randomBytes(4).toString('hex');

export interface OpcoesDreno {
  /** Intervalo entre os fechamentos das ociosas depois do SIGUSR2 (padrão 1 s). */
  intervaloMs?: number;
  /** Por quanto tempo repete o fechamento (padrão 30 s). */
  duracaoMs?: number;
}

export interface Dreno {
  readonly instancia: string;
  /** Idempotente: a segunda chamada não faz nada. */
  entrarEmDreno(): void;
  emDreno(): boolean;
}

/**
 * Registra o hook dos cabeçalhos; deve ser chamado logo depois do `Fastify()`, antes das rotas. O hook só mexe em
 * cabeçalhos e devolve o payload intacto (stream, buffer ou multipart seguem iguais).
 */
export function instalarDreno(app: FastifyInstance, o: OpcoesDreno = {}): Dreno {
  const intervaloMs = o.intervaloMs ?? 1000;
  const duracaoMs = o.duracaoMs ?? 30_000;
  let drenando = false;
  let timer: NodeJS.Timeout | undefined;

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header(CABECALHO_INSTANCIA, INSTANCIA);
    if (drenando) reply.header('connection', 'close');
    return payload;
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });

  const fecharOciosas = () => app.server.closeIdleConnections();

  return {
    instancia: INSTANCIA,
    emDreno: () => drenando,
    entrarEmDreno() {
      if (drenando) return;
      drenando = true;
      app.log.info({ modulo: 'plataforma', evento: 'dreno' }, 'entrando em dreno');
      fecharOciosas();
      const fim = Date.now() + duracaoMs;
      timer = setInterval(() => {
        fecharOciosas();
        if (Date.now() >= fim && timer) clearInterval(timer);
      }, intervaloMs);
      timer.unref();
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Dreno da troca sem parada, instalado pelo `criarApp`. */
    dreno: Dreno;
  }
}
