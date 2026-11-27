/**
 * Entrada do servidor da API: adaptadores PostgreSQL no papel `macuxierp_app` (conferido na partida: sem superusuário
 * nem BYPASSRLS), dependências de produção pelo `montarDependenciasProducao` (T-0042) e encerramento limpo no SIGTERM
 * do deploy (ADR 0003), com o dreno no SIGUSR2 (troca sem parada, dreno.ts). O log dos módulos (pedido) sai por um pino próprio, com `servico` e `modulo`, só ids e códigos.
 */
import { BancoPg, criarPool } from '@macuxierp/platform-sdk/pg';
import { pino } from 'pino';
import { criarApp } from './app';
import { lerConfigApi } from './config';
import { montarDependenciasProducao } from './modulos';

const cfg = lerConfigApi(process.env);
const pool = criarPool('macuxierp-api', cfg.poolMax);
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_app');

const log = pino({ level: 'info', base: { servico: 'macuxierp-api' } });
for (const aviso of cfg.avisos) log.warn({ modulo: 'core' }, aviso); // só nomes de variáveis, nunca valores (T-0076)
const app = await criarApp(montarDependenciasProducao({ banco, chaveA1: cfg.chaveA1, chaveIntegracao: cfg.chaveIntegracao, pepperEntrada: cfg.pepperEntrada, config: cfg, log }));
await app.listen({ port: cfg.porta, host: cfg.host });

// Troca sem parada (v0.3.25): o deploy manda SIGUSR2 antes de tirar esta réplica do túnel (dreno.ts).
process.on('SIGUSR2', () => app.dreno.entrarEmDreno());

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, 'encerrando a API');
    void app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}
