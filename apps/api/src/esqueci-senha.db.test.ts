/**
 * T-0076 no PostgreSQL migrado (depende da 0048: colunas `senha_temporaria_*` e as funções do superadmin), com os
 * adaptadores de produção no papel `macuxierp_app` (RLS valendo): o pedido grava só o hash e a auditoria, o consumo
 * concorrente deixa só um login entrar (READ COMMITTED reavalia o WHERE e vê o hash nulo), e a troca na sessão da
 * temporária dispensa a senha atual e zera as colunas. O mesmo para o superadmin pela tela única (MACUXI).
 * T-0083: o pedido roda em segundo plano depois do 202 (`aguardarSegundoPlanoEsqueci`); o login certo com a senha atual
 * cancela a temporária pendente (tenant: o `cancelarSenhaTemporaria` do `RepositorioCoreSql`, com a auditoria;
 * superadmin: `superadmin_cancelar_temporaria`). Na corrida entre o login com a senha atual e o com a temporária, os dois
 * UPDATEs (`WHERE senha_temporaria_hash IS NOT NULL`) disputam a mesma linha: só um ganha (RETURNING), e só o efeito dele vale. Os testes do superadmin dependem da migração do banco-dados com a
 * `superadmin_cancelar_temporaria` e a coluna `email` no `superadmin_para_login`; sem ela, ficam pulados.
 */
import { randomUUID } from 'node:crypto';
import { RepositorioCoreSql } from '@macuxierp/core/api';
import { COOKIE_CONFIG, CABECALHO_CSRF_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, EnvioEmailMemoria, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { aguardarSegundoPlanoEsqueci } from './auth/esqueci';
import { gerarHashSenha } from './auth/senha';

const temporariaDe = (texto: string) => /Senha temporária: (\S+)/.exec(texto)![1]!;

describe.skipIf(!PG_DISPONIVEL)('T-0076: "Esqueci a senha" e tela única no PostgreSQL (0048)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  const envio = new EnvioEmailMemoria();
  const usuario = randomUUID();
  const EMAIL = 'adm@loja-esqueci.teste';
  const EMAIL_SA = 'sa-esqueci@exemplo.invalid';
  const usuario2 = randomUUID();
  const EMAIL2 = 'adm2@loja-esqueci.teste';
  const EMAIL_SA2 = 'sa2-esqueci@exemplo.invalid';
  const usuario3 = randomUUID();
  const EMAIL3 = 'adm3@loja-esqueci.teste';
  const usuario4 = randomUUID();
  const EMAIL4 = 'adm4@loja-esqueci.teste';
  let ip = 10;
  const novoIp = () => `10.1.0.${ip++}`;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, 'am2808', ['cadastros']);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: EMAIL, nome: 'Administradora', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario2, email: EMAIL2, nome: 'Administrador Dois', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario3, email: EMAIL3, nome: 'Administradora Três', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario4, email: EMAIL4, nome: 'Administrador Quatro', filialIds: [] });
    for (const email of [EMAIL_SA, EMAIL_SA2]) {
      await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
        email,
        await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO),
      ]);
    }
    ({ app } = await appPgDeTeste({ b, esqueci: { envio, repoCore: new RepositorioCoreSql() } }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  // Como a web: com o CABECALHO_CSRF_CONFIG (o código MACUXI o exige, T-0083). O pedido roda depois do 202.
  const pedir = async (empresa: string, email: string) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/esqueci', headers: { [CABECALHO_CSRF_CONFIG]: '1', 'cf-connecting-ip': novoIp() }, payload: { empresa, email } });
    await aguardarSegundoPlanoEsqueci();
    await envio.esperar();
    return r;
  };
  // T-0083: tirar quando a migração do banco-dados (superadmin_cancelar_temporaria e o email do superadmin_para_login) chegar.
  const semSqlDoBancoT0083 = async () =>
    !(await b.admin.query<{ ok: boolean }>(
      `SELECT to_regprocedure('plataforma.superadmin_cancelar_temporaria(uuid)') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'plataforma.superadmin_para_login(text)'::regprocedure AND 'email' = ANY (proargnames)) AS ok`,
    )).rows[0]!.ok;
  // Como a web: o login único sempre com o CABECALHO_CSRF_CONFIG (o destino config o exige, ADR 0018 §5).
  const entrar = (empresa: string, email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', headers: { [CABECALHO_CSRF_CONFIG]: '1', 'cf-connecting-ip': novoIp() }, payload: { empresa, email, senha } });

  it('tenant: pedido grava o hash (72 h) e audita; dois logins simultâneos com a temporária = um 200 e um 401; troca sem a senha atual', async () => {
    expect((await pedir('AM2808', EMAIL)).statusCode).toBe(202);
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

  it('superadmin pela tela única: pedido pela superadmin_emitir_temporaria, consumo de uso único e troca sem a senha atual', async (ctx) => {
    if (await semSqlDoBancoT0083()) return ctx.skip();
    expect((await pedir('MACUXI', EMAIL_SA)).statusCode).toBe(202);
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

  it('T-0083 tenant: o login certo com a senha atual cancela a temporária pendente (colunas nulas), audita sem senha nem e-mail, e a temporária não entra mais', async () => {
    expect((await pedir('AM2808', EMAIL2)).statusCode).toBe(202);
    const temporaria = temporariaDe(envio.enviados.at(-1)!.texto);
    expect(envio.enviados.at(-1)!.para).toBe(EMAIL2);
    expect((await entrar('AM2808', EMAIL2, SENHA_DE_TESTE)).statusCode).toBe(200);
    const linha = (await b.admin.query(`SELECT senha_temporaria_hash, senha_temporaria_expira_em, deve_trocar_senha FROM plataforma.usuario WHERE id = $1`, [usuario2])).rows[0];
    expect(linha).toEqual({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: false });
    const auditoria = await b.admin.query(`SELECT usuario_id, entidade, entidade_id, antes, depois FROM plataforma.auditoria WHERE acao = 'core.usuario.senha_temporaria_cancelada'`);
    expect(auditoria.rows).toEqual([{ usuario_id: usuario2, entidade: 'usuario', entidade_id: usuario2, antes: null, depois: null }]);
    expect((await entrar('AM2808', EMAIL2, temporaria)).statusCode).toBe(401);
    // de novo com a senha atual: nada a cancelar, nenhuma auditoria nova
    expect((await entrar('AM2808', EMAIL2, SENHA_DE_TESTE)).statusCode).toBe(200);
    expect((await b.admin.query(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = 'core.usuario.senha_temporaria_cancelada'`)).rows[0]).toEqual({ n: 1 });
  });

  it('T-0083 superadmin: o login certo com a senha atual chama a superadmin_cancelar_temporaria, que zera a temporária sem mexer na troca pendente', async (ctx) => {
    if (await semSqlDoBancoT0083()) return ctx.skip();
    expect((await pedir('MACUXI', EMAIL_SA2)).statusCode).toBe(202);
    const temporaria = temporariaDe(envio.enviados.at(-1)!.texto);
    expect(envio.enviados.at(-1)!.para).toBe(EMAIL_SA2);
    expect((await entrar('MACUXI', EMAIL_SA2, SENHA_DE_TESTE)).json()).toMatchObject({ destino: 'config' });
    const sa = (await b.admin.query(`SELECT senha_temporaria_hash, senha_temporaria_expira_em, deve_trocar_senha FROM plataforma.superadmin WHERE email = $1`, [EMAIL_SA2])).rows[0];
    expect(sa).toEqual({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: false });
    expect((await entrar('MACUXI', EMAIL_SA2, temporaria)).statusCode).toBe(401);
  });

  it('T-0083 tenant com o e-mail desligado: a temporária emitida antes ainda é cancelada no login certo, com a auditoria', async () => {
    const semEmail = (await appPgDeTeste({ b })).app;
    try {
      await b.admin.query(`UPDATE plataforma.usuario SET senha_temporaria_hash = $2, senha_temporaria_expira_em = now() + interval '72 hours' WHERE id = $1`, [
        usuario3,
        await gerarHashSenha('Temporaria-antiga-1', ARGON2_RAPIDO),
      ]);
      const r = await semEmail.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'cf-connecting-ip': novoIp() }, payload: { empresa: 'AM2808', email: EMAIL3, senha: SENHA_DE_TESTE } });
      expect(r.statusCode).toBe(200);
      const linha = (await b.admin.query(`SELECT senha_temporaria_hash, senha_temporaria_expira_em FROM plataforma.usuario WHERE id = $1`, [usuario3])).rows[0];
      expect(linha).toEqual({ senha_temporaria_hash: null, senha_temporaria_expira_em: null });
      const auditoria = await b.admin.query(`SELECT usuario_id, entidade_id FROM plataforma.auditoria WHERE acao = 'core.usuario.senha_temporaria_cancelada' AND entidade_id = $1`, [usuario3]);
      expect(auditoria.rows).toEqual([{ usuario_id: usuario3, entidade_id: usuario3 }]);
    } finally {
      await semEmail.close();
    }
  });

  it('T-0083 corrida (RN-CORE-13): login com a senha atual e com a temporária ao mesmo tempo, em várias rodadas: só um efeito vale (consumo ou cancelamento), nunca os dois, e a temporária nunca vale depois', async () => {
    const RODADAS = 20;
    const TEMPORARIA = 'Temporaria-corrida-1';
    const hashTemporaria = await gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
    const cancelamentos = async () =>
      (await b.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = 'core.usuario.senha_temporaria_cancelada' AND entidade_id = $1`, [usuario4])).rows[0]!.n;
    const efeitos = { consumida: 0, cancelada: 0 };
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      // Temporária vigente e sem trava acumulada (o 401 da temporária cancelada conta como falha).
      await b.admin.query(
        `UPDATE plataforma.usuario SET senha_temporaria_hash = $2, senha_temporaria_expira_em = now() + interval '72 hours', deve_trocar_senha = false, falhas_login = 0, bloqueado_ate = NULL WHERE id = $1`,
        [usuario4, hashTemporaria],
      );
      const antes = await cancelamentos();
      const [atual, temporaria] = await Promise.all([entrar('AM2808', EMAIL4, SENHA_DE_TESTE), entrar('AM2808', EMAIL4, TEMPORARIA)]);
      expect(atual!.statusCode).toBe(200);
      expect(atual!.json()).toEqual({ destino: 'bko', token_acesso: expect.any(String), expira_em: expect.any(String) });
      const novos = (await cancelamentos()) - antes;
      if (temporaria!.statusCode === 200) {
        // Consumida: a sessão da temporária com a troca obrigatória, sem auditoria de cancelamento.
        efeitos.consumida++;
        expect(novos).toBe(0);
        const token = temporaria!.json<{ token_acesso: string }>().token_acesso;
        const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
        expect(eu.json().usuario).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
      } else {
        // Cancelada: o 401 neutro e exatamente uma auditoria de cancelamento.
        efeitos.cancelada++;
        expect(temporaria!.statusCode).toBe(401);
        expect(novos).toBe(1);
      }
      const linha = (await b.admin.query(`SELECT senha_temporaria_hash, senha_temporaria_expira_em FROM plataforma.usuario WHERE id = $1`, [usuario4])).rows[0];
      expect(linha).toEqual({ senha_temporaria_hash: null, senha_temporaria_expira_em: null });
      expect((await entrar('AM2808', EMAIL4, TEMPORARIA)).statusCode).toBe(401);
    }
    expect(efeitos.consumida + efeitos.cancelada).toBe(RODADAS);
    console.info(`T-0083 corrida: ${RODADAS} rodadas, ${efeitos.consumida} consumida(s), ${efeitos.cancelada} cancelada(s)`);
  });
});
