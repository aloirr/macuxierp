/**
 * API de ponta a ponta no PostgreSQL migrado: adaptadores PG no papel `macuxierp_app` (RLS valendo), login com argon2,
 * refresh rotativo, `GET /v1/auth/eu` e as licenças da `plataforma.tenant_modulo`. Relógio real (o banco usa now()),
 * salvo no teste do selo às 05h UTC, que fixa o instante da API.
 */
import { randomUUID } from 'node:crypto';
import { avisosA1MaisRecentes, RepositorioCoreSql } from '@macuxierp/core/api';
import { relogioDoSistema, type Relogio } from '@macuxierp/platform-sdk';
import { AuditoriaPg, FilaDeTrabalhosPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
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
  // relógio real, salvo quando um teste fixa o instante da API
  let instanteFixo: Date | null = null;
  const relogio: Relogio = { agora: () => (instanteFixo ? new Date(instanteFixo.getTime()) : relogioDoSistema.agora()) };

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
      relogio,
      avisosA1: avisosA1MaisRecentes,
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
    expect(licencas.json()).toEqual({ itens: [{ modulo: 'cadastros', ativo: true, valido_ate: null }] });
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
