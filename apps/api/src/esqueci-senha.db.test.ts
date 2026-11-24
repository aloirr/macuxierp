/**
 * T-0076 no PostgreSQL migrado (depende da 0048: colunas `senha_temporaria_*` e as funções do superadmin), com os
 * adaptadores de produção no papel `macuxierp_app` (RLS valendo): o pedido grava só o hash e a auditoria, o consumo
 * concorrente deixa só um login entrar (READ COMMITTED reavalia o WHERE e vê o hash nulo), e a troca na sessão da
 * temporária dispensa a senha atual e zera as colunas. O mesmo para o superadmin pela tela única (MACUXI).
 */
import { randomUUID } from 'node:crypto';
import { RepositorioCoreSql } from '@macuxierp/core/api';
import { COOKIE_CONFIG, CABECALHO_CSRF_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, EnvioEmailMemoria, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';

const temporariaDe = (texto: string) => /Senha temporária: (\S+)/.exec(texto)![1]!;

describe.skipIf(!PG_DISPONIVEL)('T-0076: "Esqueci a senha" e tela única no PostgreSQL (0048)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  const envio = new EnvioEmailMemoria();
  const usuario = randomUUID();
  const EMAIL = 'adm@loja-esqueci.teste';
  const EMAIL_SA = 'sa-esqueci@exemplo.invalid';
  let ip = 10;
  const novoIp = () => `10.1.0.${ip++}`;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, 'am2808', ['cadastros']);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: EMAIL, nome: 'Administradora', filialIds: [] });
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO),
    ]);
    ({ app } = await appPgDeTeste({ b, esqueci: { envio, repoCore: new RepositorioCoreSql() } }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const pedir = (empresa: string, email: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/esqueci', headers: { 'cf-connecting-ip': novoIp() }, payload: { empresa, email } });
  // Como a web: o login único sempre com o CABECALHO_CSRF_CONFIG (o destino config o exige, ADR 0018 §5).
  const entrar = (empresa: string, email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', headers: { [CABECALHO_CSRF_CONFIG]: '1', 'cf-connecting-ip': novoIp() }, payload: { empresa, email, senha } });

  it('tenant: pedido grava o hash (72 h) e audita; dois logins simultâneos com a temporária = um 200 e um 401; troca sem a senha atual', async () => {
    expect((await pedir('AM2808', EMAIL)).statusCode).toBe(202);
    await envio.esperar();
    const temporaria = temporariaDe(envio.enviados.at(-1)!.texto);
    const linha = async () =>
      (await b.admin.query<{ h: string | null; horas: number | null; deve_trocar_senha: boolean }>(
        `SELECT senha_temporaria_hash AS h, round(extract(epoch FROM senha_temporaria_expira_em - now()) / 3600)::int AS horas, deve_trocar_senha FROM plataforma.usuario WHERE id = $1`,
        [usuario],
      )).rows[0]!;
    expect(await linha()).toMatchObject({ h: expect.stringMatching(/^\$argon2id\$/), horas: 72 });
    const auditoria = await b.admin.query(`SELECT acao, usuario_id FROM plataforma.auditoria WHERE acao = 'core.usuario.senha_esquecida'`);
    expect(auditoria.rows).toEqual([{ acao: 'core.usuario.senha_esquecida', usuario_id: usuario }]);

    const [r1, r2] = await Promise.all([entrar('AM2808', EMAIL, temporaria), entrar('AM2808', EMAIL, temporaria)]);
    expect([r1!.statusCode, r2!.statusCode].sort()).toEqual([200, 401]);
    expect(await linha()).toEqual({ h: null, horas: null, deve_trocar_senha: true });
    // a antiga ainda vale até a troca
    expect((await entrar('AM2808', EMAIL, SENHA_DE_TESTE)).statusCode).toBe(200);

    const ok = r1!.statusCode === 200 ? r1! : r2!;
    expect(ok.json()).toEqual({ destino: 'bko', token_acesso: expect.any(String), expira_em: expect.any(String) });
    const token = ok.json<{ token_acesso: string }>().token_acesso;
    const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(eu.json().usuario).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
    const troca = await app.inject({ method: 'POST', url: '/v1/auth/senha', headers: { authorization: `Bearer ${token}` }, payload: { senha_nova: 'Nova-senha-789' } });
    expect(troca.statusCode).toBe(204);
    expect((await linha()).deve_trocar_senha).toBe(false);
    expect((await entrar('AM2808', EMAIL, 'Nova-senha-789')).statusCode).toBe(200);
  });

  it('superadmin pela tela única: pedido pela superadmin_emitir_temporaria, consumo de uso único e troca sem a senha atual', async () => {
    expect((await pedir('MACUXI', EMAIL_SA)).statusCode).toBe(202);
    await envio.esperar();
    const temporaria = temporariaDe(envio.enviados.at(-1)!.texto);
    const [r1, r2] = await Promise.all([entrar('macuxi', EMAIL_SA, temporaria), entrar('MACUXI', EMAIL_SA, temporaria)]);
    expect([r1!.statusCode, r2!.statusCode].sort()).toEqual([200, 401]);
    const ok = r1!.statusCode === 200 ? r1! : r2!;
    expect(ok.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    const cookie = ok.cookies.find((c) => c.name === COOKIE_CONFIG)!.value;
    const eu = await app.inject({ url: '/v1/plataforma/auth/eu', cookies: { [COOKIE_CONFIG]: cookie } });
    expect(eu.json()).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
    const troca = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/senha', headers: { [CABECALHO_CSRF_CONFIG]: '1' }, cookies: { [COOKIE_CONFIG]: cookie }, payload: { senha_nova: 'Nova-senha-789' } });
    expect(troca.statusCode).toBe(204);
    const sa = (await b.admin.query(`SELECT senha_temporaria_hash, senha_temporaria_expira_em, deve_trocar_senha FROM plataforma.superadmin WHERE email = $1`, [EMAIL_SA])).rows[0];
    expect(sa).toEqual({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: false });
    expect((await entrar('MACUXI', EMAIL_SA, 'Nova-senha-789')).json()).toMatchObject({ destino: 'config' });
  });
});
