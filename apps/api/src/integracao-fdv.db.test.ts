/**
 * Integração FDV montada na API (T-0011, T-0056): com as dependências de produção (`montarDependenciasProducao`, papel
 * `macuxierp_app`, RLS) e sem a `MACUXIERP_CHAVE_INTEGRACAO`, a API sobe e o `GET /v1/integracao-fdv/monitor` responde.
 * As rotas de escrita (credencial, configuração, carga) saem do BKO para o portal /config (ADR 0013); a cobertura com e
 * sem a chave mestra volta no PR casado, pelas rotas do portal. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';

const LICENCAS = ['cadastros', 'pedido', 'integracao-fdv'];

describe.skipIf(!PG_DISPONIVEL)('integração FDV montada na API: sem a chave mestra (PostgreSQL)', () => {
  let b: BancoEfemero;
  let semChave: FastifyInstance;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, 'loja-sem-chave', LICENCAS);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: 'adm@loja-sem-chave.teste', nome: 'Administradora', filialIds: [] });
    ({ app: semChave } = await appPgDeTeste({ b, modulos: 'producao' }));
  });
  afterAll(async () => {
    await semChave?.close();
    await b?.remover();
  });

  it('sem a chave mestra: a API sobe e o GET /monitor responde', async () => {
    const login = await semChave.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { empresa: 'loja-sem-chave', email: 'adm@loja-sem-chave.teste', senha: SENHA_DE_TESTE },
    });
    expect(login.statusCode).toBe(200);
    const auth = `Bearer ${login.json<{ token_acesso: string }>().token_acesso}`;
    const monitor = await semChave.inject({ method: 'GET', url: '/v1/integracao-fdv/monitor', headers: { authorization: auth } });
    expect(monitor.statusCode).toBe(200);
  });
});
