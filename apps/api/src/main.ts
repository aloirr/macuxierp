/**
 * Entrada do servidor da API: adaptadores PostgreSQL no papel `macuxierp_app` (conferido na partida: sem superusuário
 * nem BYPASSRLS), core e cadastros montados com os adaptadores reais e encerramento limpo no SIGTERM do deploy (ADR 0003).
 * O armazenamento de arquivos responde 503 até o adaptador S3 da T-0024.
 */
import { LeitorPfxTls, RepositorioCoreSql } from '@macuxierp/core/api';
import { relogioDoSistema } from '@macuxierp/platform-sdk';
import { AuditoriaPg, BancoPg, criarPool, FilaDeTrabalhosPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import { criarApp } from './app';
import { RepositorioAuthPg } from './auth/repositorio-pg';
import { gerarHashSenha } from './auth/senha';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { lerConfigApi } from './config';
import { armazenamentoIndisponivel, montarModulos } from './modulos';

const cfg = lerConfigApi(process.env);
const pool = criarPool('macuxierp-api', cfg.poolMax);
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_app');

const app = await criarApp({
  versao: cfg.versao,
  auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: cfg.jwtSegredo },
  cookieSeguro: cfg.cookieSeguro,
  banco,
  repoAuth: new RepositorioAuthPg(),
  licencas: new LicencasPg(),
  outbox: new OutboxPg(),
  auditoria: new AuditoriaPg(),
  trabalhos: new FilaDeTrabalhosPg(),
  relogio: relogioDoSistema,
  modulos: montarModulos({
    core: { repo: new RepositorioCoreSql(), hashSenha: (senha) => gerarHashSenha(senha), leitorPfx: new LeitorPfxTls(), chaveA1: cfg.chaveA1, armazenamento: armazenamentoIndisponivel },
  }),
});
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
