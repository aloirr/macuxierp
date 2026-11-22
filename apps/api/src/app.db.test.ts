/**
 * API de ponta a ponta no PostgreSQL migrado: adaptadores PG no papel `macuxierp_app` (RLS valendo), login com argon2,
 * refresh rotativo, `GET /v1/auth/eu` e as licenças da `plataforma.tenant_modulo`. Relógio real (o banco usa now()).
 */
import { randomUUID } from 'node:crypto';
import { RepositorioCoreSql } from '@macuxierp/core/api';
import { relogioDoSistema } from '@macuxierp/platform-sdk';
import { AuditoriaPg, FilaDeTrabalhosPg, IdempotenciaPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COOKIE_REFRESH, criarApp } from './app';
import { RepositorioAuthPg } from './auth/repositorio-pg';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { gerarHashSenha } from './auth/senha';
import { dependenciasCoreDeTeste } from './apoio-teste';
import { montarModulos } from './modulos';

const SENHA = 'senha-de-teste-123';
const ARGON2_RAPIDO = { memoria: 64, passes: 1, paralelismo: 1 };

describe.skipIf(!PG_DISPONIVEL)('API no PostgreSQL (papel macuxierp_app)', () => {
  let b: BancoEfemero;
  let app: Awaited<ReturnType<typeof criarApp>>;
  let tenant: string;
  const usuario = randomUUID();
  const matriz = randomUUID();
  const filialOutro = randomUUID();

  async function filial(tenantId: string, id: string, cnpj: string, nome: string) {
    await b.admin.query(
      `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, nome_fantasia, crt, logradouro, numero, bairro,
         municipio_ibge, uf, cep) VALUES ($1, $2, $3, $4, $4, '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000')`,
      [id, tenantId, cnpj, nome],
    );
  }

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'loja-um', ['cadastros']);
    const outro = await criarTenant(b.admin, 'loja-dois', ['cadastros', 'pedido']);
    await filial(tenant, matriz, '11222333000181', 'Matriz Manaus');
    await filial(outro, filialOutro, '11444777000161', 'Filial de outro tenant');
    // filial_ids com uma filial de outro tenant: a RLS da cadastros.filial_resumo a esconde no /eu.
    await b.admin.query(
      `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids)
       VALUES ($1, $2, 'adm@loja-um.teste', 'Administradora', $3, 'administrador', $4::uuid[])`,
      [usuario, tenant, await gerarHashSenha(SENHA, ARGON2_RAPIDO), [matriz, filialOutro]],
    );
    app = await criarApp({
      versao: 'teste',
      auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: 'segredo-de-teste-com-mais-de-32-caracteres', argon2: ARGON2_RAPIDO },
      cookieSeguro: true,
      banco: b.banco('macuxierp_app'),
      repoAuth: new RepositorioAuthPg(),
      licencas: new LicencasPg(),
      outbox: new OutboxPg(),
      auditoria: new AuditoriaPg(),
      trabalhos: new FilaDeTrabalhosPg(),
      idempotencia: new IdempotenciaPg(),
      relogio: relogioDoSistema,
      // core e cadastros com os adaptadores SQL de produção (armazenamento em memória)
      modulos: montarModulos({ core: dependenciasCoreDeTeste(new RepositorioCoreSql()) }),
      logger: false,
    });
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const entrar = (senha = SENHA, empresa = 'loja-um') =>
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
      usuario: { id: usuario, nome: 'Administradora', perfil: 'administrador' },
      empresa: { id: tenant, slug: 'loja-um', razao_social: 'Empresa loja-um', fuso: 'America/Manaus' },
      // só a filial do próprio tenant (RLS), embora o filial_ids cite a do outro
      filiais: [{ id: matriz, nome: 'Matriz Manaus', cnpj: '11222333000181' }],
      // core (sempre) e cadastros (licenciado); pedido é licença só do outro tenant
      modulos: [expect.objectContaining({ id: 'core' }), expect.objectContaining({ id: 'cadastros' })],
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
    expect(licencas.json()).toEqual({ itens: [{ modulo: 'cadastros', ativo: true, valido_ate: null }] });
    const filiais = await get('/v1/cadastros/filiais');
    expect(filiais.statusCode).toBe(200);
    expect(filiais.json().itens.map((f: { id: string }) => f.id)).toEqual([matriz]);
  });

  it('senha errada conta a falha no banco; slug de outro tenant ou inexistente dá o mesmo 401', async () => {
    expect((await entrar('errada')).statusCode).toBe(401);
    const { rows } = await b.admin.query('SELECT falhas_login FROM plataforma.usuario WHERE id = $1', [usuario]);
    expect(rows).toEqual([{ falhas_login: 1 }]);
    for (const empresa of ['loja-dois', 'nao-existe']) expect((await entrar(SENHA, empresa)).statusCode).toBe(401);
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
