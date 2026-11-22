/**
 * Entrada do servidor da API: adaptadores PostgreSQL no papel `macuxierp_app` (conferido na partida: sem superusuário
 * nem BYPASSRLS), dependências de produção pelo `montarDependenciasProducao` (T-0042) e encerramento limpo no SIGTERM
 * do deploy (ADR 0003).
 */
import { BancoPg, criarPool } from '@macuxierp/platform-sdk/pg';
import { criarApp } from './app';
import { lerConfigApi } from './config';
import { montarDependenciasProducao } from './modulos';

const cfg = lerConfigApi(process.env);
const pool = criarPool('macuxierp-api', cfg.poolMax);
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_app');

const app = await criarApp(montarDependenciasProducao({ banco, chaveA1: cfg.chaveA1, config: cfg }));
await app.listen({ port: cfg.porta, host: cfg.host });

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, 'encerrando a API');
    void app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}
