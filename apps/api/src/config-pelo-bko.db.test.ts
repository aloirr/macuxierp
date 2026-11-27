/**
 * 45 A (ADR 0012 §1-A, v0.3.21) no PostgreSQL migrado com a 0076, com os adaptadores de produção: o usuário do BKO com um
 * superadmin válido do mesmo e-mail abre o `/config` pelo `POST /v1/auth/config` (o refresh do BKO + o anti-CSRF), sem
 * novo login e sem efeito no login do superadmin. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import {
  ACAO_ENTRAR_PELO_BKO,
  CABECALHO_CSRF_CONFIG,
  CAMINHO_ENTRAR_PELO_BKO,
  CODIGO_SEM_ACESSO_CONFIG,
  CODIGO_TROCAR_SENHA,
  COOKIE_CONFIG,
  EuResposta,
  PREFIXO_PLATAFORMA,
  SessaoPlataformaResposta,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { COOKIE_REFRESH } from './app';
import { gerarHashSenha } from './auth/senha';

const EMAIL = 'ana@loja-config.teste';
const EMAIL_SEM_SA = 'bia@loja-config.teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };

describe.skipIf(!PG_DISPONIVEL)('45 A: entrar no /config pela sessão do BKO (PostgreSQL, 0076)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let ip = 10;

  /** Login no BKO pela tela única: o token de acesso e o refresh (o cookie do /v1/auth). */
  const entrarNoBko = async (email: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { ...CSRF, 'cf-connecting-ip': `10.3.0.${ip++}` },
      payload: { empresa: 'AM2809', email, senha: SENHA_DE_TESTE },
    });
    expect(r.statusCode, r.body).toBe(200);
    return { acesso: r.json<{ token_acesso: string }>().token_acesso, refresh: r.cookies.find((c) => c.name === COOKIE_REFRESH)!.value };
  };
  const abrirConfig = (refresh?: string, headers: Record<string, string> = CSRF) =>
    app.inject({ method: 'POST', url: CAMINHO_ENTRAR_PELO_BKO, headers, ...(refresh ? { cookies: { [COOKIE_REFRESH]: refresh } } : {}) });
  const cookieConfig = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === COOKIE_CONFIG);
  const euConfig = (token: string) => app.inject({ url: `${PREFIXO_PLATAFORMA}/auth/eu`, cookies: { [COOKIE_CONFIG]: token } });
  const euBko = async (acesso: string) => EuResposta.parse((await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${acesso}` } })).json());
  const superadmin = (sql: string) => b.admin.query(`UPDATE plataforma.superadmin SET ${sql} WHERE email = $1`, [EMAIL]);

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, 'am2809', ['cadastros']);
    for (const email of [EMAIL, EMAIL_SEM_SA]) await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email, nome: 'Administradora', filialIds: [] });
    // o mesmo e-mail do 1º usuário (o CHECK do superadmin exige lower(btrim)); o 2º não tem superadmin
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL,
      await gerarHashSenha('outra-senha-do-superadmin-1', ARGON2_RAPIDO),
    ]);
    ({ app } = await appPgDeTeste({ b }));
  }, 180_000);
  const APTO = 'ativo = true, falhas_login = 0, bloqueado_ate = NULL, deve_trocar_senha = false';
  beforeEach(() => superadmin(APTO));
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('com superadmin válido: acesso_config no /eu, 200 com o cookie do /config (Path=/v1/plataforma) e o portal abre', async () => {
    const bko = await entrarNoBko(EMAIL);
    expect((await euBko(bko.acesso)).acesso_config).toBe(true);
    const r = await abrirConfig(bko.refresh);
    expect(r.statusCode, r.body).toBe(200);
    SessaoPlataformaResposta.parse(r.json());
    const cookie = cookieConfig(r)!;
    expect(cookie).toMatchObject({ path: PREFIXO_PLATAFORMA, httpOnly: true });
    const eu = await euConfig(cookie.value);
    expect(eu.statusCode, eu.body).toBe(200);
    expect(eu.json()).toMatchObject({ deve_trocar_senha: false });
    // o teto: nunca depois da sessão do BKO nem das 8 h
    expect(new Date(r.json<{ expira_em: string }>().expira_em).getTime()).toBeLessThanOrEqual(Date.now() + 8 * 3_600_000 + 60_000);
  });

  it('sem argon2, sem efeito no login do superadmin: falhas_login e a trava não mudam; auditado sem e-mail', async () => {
    await superadmin('falhas_login = 2');
    const bko = await entrarNoBko(EMAIL);
    expect((await abrirConfig(bko.refresh)).statusCode).toBe(200);
    const [sa] = (await b.admin.query<{ falhas_login: number }>('SELECT falhas_login FROM plataforma.superadmin WHERE email = $1', [EMAIL])).rows;
    expect(sa!.falhas_login).toBe(2);
    const auditoria = (await b.admin.query<{ l: string }>('SELECT to_jsonb(a)::text AS l FROM plataforma.auditoria a WHERE acao = $1', [ACAO_ENTRAR_PELO_BKO])).rows;
    expect(auditoria.length).toBeGreaterThanOrEqual(1);
    for (const { l } of auditoria) {
      expect(l).not.toContain(EMAIL);
      expect(l).not.toContain(bko.refresh);
    }
  });

  it('uma sessão do /config por sessão do BKO: abrir de novo revoga a anterior', async () => {
    const bko = await entrarNoBko(EMAIL);
    const primeira = cookieConfig(await abrirConfig(bko.refresh))!.value;
    const segunda = cookieConfig(await abrirConfig(bko.refresh))!.value;
    expect((await euConfig(primeira)).statusCode).toBe(401);
    expect((await euConfig(segunda)).statusCode).toBe(200);
  });

  it('sem superadmin do mesmo e-mail, ou com ele inativo, travado ou com troca pendente: sem item no menu e 403 SEM_ACESSO_CONFIG', async () => {
    const semSa = await entrarNoBko(EMAIL_SEM_SA);
    expect((await euBko(semSa.acesso)).acesso_config).toBeUndefined();
    const r = await abrirConfig(semSa.refresh);
    expect([r.statusCode, r.json().codigo]).toEqual([403, CODIGO_SEM_ACESSO_CONFIG]);
    expect(cookieConfig(r)).toBeUndefined();
    for (const estado of ['ativo = false', "bloqueado_ate = now() + interval '1 hour'", 'deve_trocar_senha = true']) {
      await superadmin(APTO);
      await superadmin(estado);
      const bko = await entrarNoBko(EMAIL);
      expect((await euBko(bko.acesso)).acesso_config, estado).toBeUndefined();
      const x = await abrirConfig(bko.refresh);
      expect([x.statusCode, x.json().codigo], estado).toEqual([403, CODIGO_SEM_ACESSO_CONFIG]);
    }
  });

  it('usuário do BKO com troca de senha pendente: 403 TROCAR_SENHA', async () => {
    const bko = await entrarNoBko(EMAIL);
    await b.admin.query('UPDATE plataforma.usuario SET deve_trocar_senha = true WHERE email = $1', [EMAIL]);
    try {
      const r = await abrirConfig(bko.refresh);
      expect([r.statusCode, r.json().codigo]).toEqual([403, CODIGO_TROCAR_SENHA]);
    } finally {
      await b.admin.query('UPDATE plataforma.usuario SET deve_trocar_senha = false WHERE email = $1', [EMAIL]);
    }
  });

  it('sem o refresh, refresh desconhecido ou revogado: 401; sem o anti-CSRF: 403 ORIGEM_RECUSADA', async () => {
    expect((await abrirConfig()).statusCode).toBe(401);
    expect((await abrirConfig('a'.repeat(43))).statusCode).toBe(401);
    const bko = await entrarNoBko(EMAIL);
    const semCsrf = await abrirConfig(bko.refresh, {});
    expect([semCsrf.statusCode, semCsrf.json().codigo]).toEqual([403, 'ORIGEM_RECUSADA']);
    await app.inject({ method: 'POST', url: '/v1/auth/sair', cookies: { [COOKIE_REFRESH]: bko.refresh } });
    expect((await abrirConfig(bko.refresh)).statusCode).toBe(401);
  });
});
