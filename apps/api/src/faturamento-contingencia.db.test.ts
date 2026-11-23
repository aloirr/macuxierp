/**
 * T-0021: a rota de contingência da filial (RN-FAT-05, RN-FAT-10; a EPEC fica desligada na v0.3.0) com as dependências de produção (`montarDependenciasProducao`,
 * que usa o `dependenciasFaturamento` do `modulos.ts`) responde pelo adaptador SQL, nunca 503 "contingência indisponível".
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from './apoio-teste';

describe.skipIf(!PG_DISPONIVEL)('T-0021: contingência do faturamento ligada na API de produção', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let token: string;
  const filial = randomUUID();

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, `t0021c-${randomUUID().slice(0, 8)}`, ['faturamento', 'fiscal']);
    await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: '11222333000181', nome: 'Matriz Manaus (teste)' });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: 'adm@t0021c.teste', nome: 'Administração', filialIds: [filial] });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    const slug = (await b.admin.query('SELECT slug FROM plataforma.tenant WHERE id = $1', [tenant])).rows[0].slug;
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: slug, email: 'adm@t0021c.teste', senha: SENHA_DE_TESTE } });
    expect(login.statusCode, login.body).toBe(200);
    token = login.json<{ token_acesso: string }>().token_acesso;
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const get = (url: string) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });

  it('GET /v1/faturamento/filiais/:id/contingencia: 200 pelo SQL (sem contingência aberta, histórico vazio, SVC indisponível), não 503', async () => {
    const r = await get(`/v1/faturamento/filiais/${filial}/contingencia`);
    expect(r.statusCode, r.body).toBe(200);
    // RN-FAT-10: a porta `svcDisponivel` não é ligada na produção (v0.3.0) = SVC indisponível, nem o administrador pode abrir.
    expect(r.json()).toMatchObject({ filial_id: filial, ambiente: 'homologacao', aberta: null, historico: [], pode_abrir: false });
  });
});
