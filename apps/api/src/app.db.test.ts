/**
 * API de ponta a ponta no PostgreSQL migrado: adaptadores PG no papel `macuxierp_app` (RLS valendo), login com argon2,
 * refresh rotativo, `GET /v1/auth/eu` e as licenças da `plataforma.tenant_modulo`. Relógio real (o banco usa now()),
 * salvo no teste do selo às 05h UTC, que fixa o instante da API.
 */
import { randomUUID } from 'node:crypto';
import { defineModule, definirPlugin, definirRota, relogioDoSistema, type Relogio } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_REFRESH } from './app';
import { appPgDeTeste, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from './apoio-teste';

describe.skipIf(!PG_DISPONIVEL)('API no PostgreSQL (papel macuxierp_app)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenant: string;
  const usuario = randomUUID();
  const matriz = randomUUID();
  const filialOutro = randomUUID();
  // relógio real, salvo quando um teste fixa o instante da API
  let instanteFixo: Date | null = null;
  const relogio: Relogio = { agora: () => (instanteFixo ? new Date(instanteFixo.getTime()) : relogioDoSistema.agora()) };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'am0001', ['cadastros']);
    const outro = await criarTenant(b.admin, 'am0002', ['cadastros', 'pedido']);
    await inserirFilialDeTeste(b.admin, tenant, { id: matriz, cnpj: '11222333000181', nome: 'Matriz Manaus' });
    await inserirFilialDeTeste(b.admin, outro, { id: filialOutro, cnpj: '11444777000161', nome: 'Filial de outro tenant' });
    // filial_ids com uma filial de outro tenant: a RLS da cadastros.filial_resumo a esconde no /eu.
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: 'adm@loja-um.teste', nome: 'Administradora', filialIds: [matriz, filialOutro] });
    // dependências de produção; core e cadastros com os adaptadores SQL (armazenamento em memória)
    ({ app } = await appPgDeTeste({ b, relogio }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const entrar = (senha = SENHA_DE_TESTE, empresa = 'am0001') =>
    app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa, email: 'ADM@loja-um.teste', senha } });
  const refreshDe = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === COOKIE_REFRESH)!.value;
  const comRefresh = (url: string, refresh: string) => app.inject({ method: 'POST', url, cookies: { [COOKIE_REFRESH]: refresh } });

  it('saúde com o banco de pé', async () => {
    expect((await app.inject('/v1/saude')).json()).toEqual({ status: 'ok', versao: 'teste', banco: 'ok' });
  });

  it('login, /eu, refresh rotativo, reuso derruba a família e sair', async () => {
    const login = await entrar();
    expect(login.statusCode).toBe(200);
    const token = login.json<{ token_acesso: string }>().token_acesso;

    const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toEqual({
      usuario: { id: usuario, nome: 'Administradora', perfil: 'administrador', deve_trocar_senha: false },
      empresa: { id: tenant, slug: 'am0001', razao_social: 'Empresa am0001', fuso: 'America/Manaus' },
      // só a filial do próprio tenant (RLS), embora o filial_ids cite a do outro
      filiais: [{ id: matriz, nome: 'Matriz Manaus', cnpj: '11222333000181' }],
      // core (sempre) e cadastros (licenciado); pedido é licença só do outro tenant
      modulos: [expect.objectContaining({ id: 'core' }), expect.objectContaining({ id: 'cadastros' })],
      avisos_a1: [],
    });

    const r1 = refreshDe(login);
    const novo = await comRefresh('/v1/auth/refresh', r1);
    expect(novo.statusCode).toBe(200);
    const r2 = refreshDe(novo);
    expect(r2).not.toBe(r1);
    // reuso do r1 (já revogado): 401 e a família inteira cai, inclusive o r2
    expect((await comRefresh('/v1/auth/refresh', r1)).statusCode).toBe(401);
    expect((await comRefresh('/v1/auth/refresh', r2)).statusCode).toBe(401);
    const { rows } = await b.admin.query('SELECT count(*)::int AS abertas FROM plataforma.sessao WHERE usuario_id = $1 AND revogada_em IS NULL', [usuario]);
    expect(rows).toEqual([{ abertas: 0 }]);

    const outra = refreshDe(await entrar());
    expect((await comRefresh('/v1/auth/sair', outra)).statusCode).toBe(204);
    expect((await comRefresh('/v1/auth/refresh', outra)).statusCode).toBe(401);
    const acesso = await b.admin.query('SELECT ultimo_acesso_em IS NOT NULL AS ok FROM plataforma.usuario WHERE id = $1', [usuario]);
    expect(acesso.rows).toEqual([{ ok: true }]);
  });

  it('core e cadastros montados com SQL de verdade: licenças e filiais do próprio tenant (RLS)', async () => {
    const token = (await entrar()).json<{ token_acesso: string }>().token_acesso;
    const get = (url: string) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });
    const licencas = await get('/v1/core/licencas');
    expect(licencas.statusCode).toBe(200);
    expect(licencas.json()).toEqual({ itens: [{ modulo: 'cadastros', ativo: true, valido_ate: null }], proximo_cursor: null });
    const filiais = await get('/v1/cadastros/filiais');
    expect(filiais.statusCode).toBe(200);
    expect(filiais.json().itens.map((f: { id: string }) => f.id)).toEqual([matriz]);
  });

  it('T-0035 (RF-CORE-04): selo do A1 no /eu com os avisos de hoje (UTC) do próprio tenant, pela core.aviso_a1', async () => {
    // hora-fixa-ok: o /eu lê o dia UTC do relógio real da API (relogioDoSistema), o mesmo dia gravado aqui
    const hoje = new Date().toISOString().slice(0, 10);
    // hora-fixa-ok: meio dia de folga sobre o relógio real; o /eu recalcula `dias` na leitura (floor) e dá 10 como o gravado
    const validoAte = new Date(Date.now() + 10.5 * 86_400_000);
    validoAte.setUTCMilliseconds(0);
    const cert = async (tenantId: string, filialId: string) => {
      const id = randomUUID();
      await b.admin.query(
        `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
         VALUES ($1, $2, $3, 'Titular', '11222333000181', $4, $5, $6, $7, $8, $7, $9, true)`,
        [id, tenantId, filialId, new Date(validoAte.getTime() - 365 * 86_400_000), validoAte, 'cd'.repeat(32), Buffer.from('x'), Buffer.alloc(12, 1), Buffer.alloc(12, 2)],
      );
      await b.admin.query('INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia) VALUES ($1, $2, $3, $4, 10, $5::date)', [tenantId, id, filialId, validoAte, hoje]);
    };
    await cert(tenant, matriz);
    await cert((await b.admin.query<{ tenant_id: string }>('SELECT tenant_id FROM cadastros.filial WHERE id = $1', [filialOutro])).rows[0]!.tenant_id, filialOutro);
    try {
      const token = (await entrar()).json<{ token_acesso: string }>().token_acesso;
      const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
      expect(eu.statusCode).toBe(200);
      // só o aviso do próprio tenant (RLS); sem titular nem CNPJ do certificado
      expect(eu.json().avisos_a1).toEqual([{ filial_id: matriz, dias: 10, valido_ate: validoAte.toISOString() }]);
    } finally {
      await b.admin.query('DELETE FROM core.aviso_a1');
      await b.admin.query('DELETE FROM core.certificado');
    }
  });

  it('T-0035 (RF-CORE-04, RN-CORE-06): às 05h UTC, só com o aviso de ontem, o selo aparece com dias recalculado', async () => {
    const validoAte = new Date('2026-12-25T10:00:00Z');
    const cert = randomUUID();
    await b.admin.query(
      `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, ativo)
       VALUES ($1, $2, $3, 'Titular', '11222333000181', $4, $5, $6, $7, $8, $7, $9, true)`,
      [cert, tenant, matriz, new Date('2025-12-25T10:00:00Z'), validoAte, 'ef'.repeat(32), Buffer.from('x'), Buffer.alloc(12, 1), Buffer.alloc(12, 2)],
    );
    // gravado ontem às 11h UTC, com 16 dias; a rodada de hoje ainda não passou
    await b.admin.query("INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia) VALUES ($1, $2, $3, $4, 16, '2026-12-09'::date)", [tenant, cert, matriz, validoAte]);
    instanteFixo = new Date('2026-12-10T05:00:00Z');
    try {
      const token = (await entrar()).json<{ token_acesso: string }>().token_acesso;
      const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
      expect(eu.statusCode).toBe(200);
      expect(eu.json().avisos_a1).toEqual([{ filial_id: matriz, dias: 15, valido_ate: validoAte.toISOString() }]);
    } finally {
      instanteFixo = null;
      await b.admin.query('DELETE FROM core.aviso_a1');
      await b.admin.query('DELETE FROM core.certificado');
    }
  });

  it('T-0042: a rota de módulo recebe o fuso do tenant (America/Sao_Paulo), lido junto com as licenças', async () => {
    const t = await criarTenant(b.admin, 'sp0001', ['cadastros']);
    await b.admin.query("UPDATE plataforma.tenant SET fuso = 'America/Sao_Paulo' WHERE id = $1", [t]);
    await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email: 'adm@loja-sp.teste', nome: 'Adm SP', filialIds: [] });
    const manifesto = defineModule({ id: 'cadastros', versao: '0.1.0', descricao: 'eco do fuso', depende: ['core'], perfis: ['administrador'], publica: [], consome: [] });
    const eco = definirPlugin(manifesto, [definirRota({ metodo: 'GET', caminho: '/fuso', acao: 'cadastros.ver', executar: async (c) => ({ corpo: { fuso: c.fuso ?? null } }) })]);
    const { app: comEco } = await appPgDeTeste({ b, relogio, modulos: [eco] });
    try {
      const login = await comEco.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'sp0001', email: 'adm@loja-sp.teste', senha: SENHA_DE_TESTE } });
      const token = login.json<{ token_acesso: string }>().token_acesso;
      const fuso = (bearer: string) => comEco.inject({ url: '/v1/cadastros/fuso', headers: { authorization: `Bearer ${bearer}` } });
      expect((await fuso(token)).json()).toEqual({ fuso: 'America/Sao_Paulo' });
      const manaus = (await entrar()).json<{ token_acesso: string }>().token_acesso;
      expect((await fuso(manaus)).json()).toEqual({ fuso: 'America/Manaus' });
    } finally {
      await comEco.close();
    }
  });

  it('senha errada conta a falha no banco; slug de outro tenant ou inexistente dá o mesmo 401', async () => {
    expect((await entrar('errada')).statusCode).toBe(401);
    const { rows } = await b.admin.query('SELECT falhas_login FROM plataforma.usuario WHERE id = $1', [usuario]);
    expect(rows).toEqual([{ falhas_login: 1 }]);
    for (const empresa of ['am0002', 'am9999']) expect((await entrar(SENHA_DE_TESTE, empresa)).statusCode).toBe(401);
    // o login certo zera a contagem
    expect((await entrar()).statusCode).toBe(200);
    expect((await b.admin.query('SELECT falhas_login FROM plataforma.usuario WHERE id = $1', [usuario])).rows).toEqual([{ falhas_login: 0 }]);
  });

  it('tenant suspenso não entra', async () => {
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [tenant]);
    try {
      expect((await entrar()).statusCode).toBe(401);
    } finally {
      await b.admin.query("UPDATE plataforma.tenant SET situacao = 'ativo' WHERE id = $1", [tenant]);
    }
  });
});
