/**
 * Entrada do worker: adaptadores PostgreSQL no papel `macuxierp_worker` (conferido na partida: sem superusuário nem
 * BYPASSRLS), laço da outbox e dos trabalhos e encerramento limpo no SIGTERM do deploy (ADR 0003).
 * Ambiente: conexão pelas variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_worker`, `PGPASSWORD`,
 * `PGDATABASE`); `MACUXIERP_WORKER_INTERVALO_MS` (padrão 1000) e `MACUXIERP_PG_POOL` (padrão 5). Nada de segredo em código.
 * Executores e rotinas: `modulos.ts` (exportação LGPD e alerta do A1, com os adaptadores SQL do core). O log leva só
 * contagens, ids e nomes de erro, nunca dado pessoal (regra 8).
 */
import { armazenamentoIndisponivel, relogioDoSistema } from '@macuxierp/platform-sdk';
import { BancoPg, CatalogoArquivosPg, criarPool } from '@macuxierp/platform-sdk/pg';
import { pino } from 'pino';
import { montarExecutores, montarRotinas } from './modulos';
import { FilaOutboxPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { iniciarWorker } from './worker';

function inteiro(nome: string, padrao: number, min: number, max: number): number {
  const bruto = process.env[nome];
  const n = bruto === undefined || bruto === '' ? padrao : Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`configuração inválida: ${nome} (inteiro de ${min} a ${max})`);
  return n;
}

const log = pino({ level: 'info', base: { servico: 'macuxierp-worker' } });
const pool = criarPool('macuxierp-worker', inteiro('MACUXIERP_PG_POOL', 5, 2, 50));
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_worker');

const worker = iniciarWorker({
  banco,
  outbox: new FilaOutboxPg(),
  trabalhos: new ReservaTrabalhosPg(),
  consumo: new RegistroConsumoPg(),
  consumidores: [],
  executores: montarExecutores({ banco, log, armazenamento: armazenamentoIndisponivel, catalogo: new CatalogoArquivosPg(), agora: () => relogioDoSistema.agora() }),
  rotinas: montarRotinas({ banco, log }),
  relogio: relogioDoSistema,
  log,
  intervaloMs: inteiro('MACUXIERP_WORKER_INTERVALO_MS', 1_000, 100, 60_000),
});
log.info('worker no ar');

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    log.info({ sinal }, 'encerrando o worker');
    void worker
      .parar()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}
