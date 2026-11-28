/**
 * T-0133 (v0.3.30), ADR 0021 §7 (opção A), teste obrigatório no PostgreSQL migrado (com a 0079 e a
 * `plataforma.conta_por_email`), com os adaptadores de produção:
 * - usuário de empresa e superadmin com o MESMO e-mail: a senha do usuário dá `destino: 'bko'` e nenhum `COOKIE_CONFIG`;
 *   a senha do superadmin dá 401 `NAO_AUTENTICADO`; o `/config` abre pelo `POST /v1/auth/config` dessa sessão do BKO;
 * - e-mail só de superadmin: `destino: 'config'` com o cookie do `/config`;
 * - empresa suspensa: 403 `EMPRESA_SUSPENSA` só com a senha certa (§3); encerrada = e-mail inexistente.
 * Sem empresa no corpo (§6). Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import {
  CABECALHO_CSRF_CONFIG,
  CAMINHO_ENTRAR_PELO_BKO,
  CODIGO_EMPRESA_SUSPENSA,
  COOKIE_CONFIG,
  MENSAGEM_EMPRESA_SUSPENSA,
  MENSAGEM_LOGIN_INVALIDO,
  PREFIXO_PLATAFORMA,
  SessaoPlataformaResposta,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { COOKIE_REFRESH } from './app';
import { gerarHashSenha } from './auth/senha';

const DUPLO = 'ana@login-email.teste';
const SO_SUPERADMIN = 'root@login-email.teste';
const DA_SUSPENSA = 'bia@login-email.teste';
const DA_ENCERRADA = 'cid@login-email.teste';
const SENHA_SA = 'outra-senha-do-superadmin-1';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
const NEUTRO_401 = { codigo: 'NAO_AUTENTICADO', mensagem: MENSAGEM_LOGIN_INVALIDO };

describe.skipIf(!PG_DISPONIVEL)('ADR 0021: login só por e-mail no PostgreSQL (conta_por_email, 0079)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let ip = 10;

  /** A tela única como a web manda desde a T-0133: só e-mail e senha, sempre com o anti-CSRF do /config. */
  const login = (email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', headers: { ...CSRF, 'cf-connecting-ip': `10.4.0.${ip++}` }, payload: { email, senha } });
  const cookie = (r: { cookies: { name: string; value: string }[] }, nome: string) => r.cookies.find((c) => c.name === nome);

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const ativa = await criarTenant(b.admin, 'am2810', ['cadastros']);
    const suspensa = await criarTenant(b.admin, 'am2811', ['cadastros']);
    const encerrada = await criarTenant(b.admin, 'am2812', ['cadastros']);
    await inserirAdministradorDeTeste(b.admin, ativa, { id: randomUUID(), email: DUPLO, nome: 'Administradora', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, suspensa, { id: randomUUID(), email: DA_SUSPENSA, nome: 'Administradora', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, encerrada, { id: randomUUID(), email: DA_ENCERRADA, nome: 'Administradora', filialIds: [] });
    await b.admin.query(`UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1`, [suspensa]);
    await b.admin.query(`UPDATE plataforma.tenant SET situacao = 'encerrado' WHERE id = $1`, [encerrada]);
    const hashSa = await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO);
    for (const email of [DUPLO, SO_SUPERADMIN]) {
      await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [email, hashSa]);
    }
    ({ app } = await appPgDeTeste({ b }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('§7: mesmo e-mail no usuário e no superadmin, senha do usuário: destino bko, sem COOKIE_CONFIG; o /config abre pelo POST /v1/auth/config', async () => {
    const r = await login(DUPLO, SENHA_DE_TESTE);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ destino: 'bko', token_acesso: expect.any(String) });
    expect(cookie(r, COOKIE_CONFIG)).toBeUndefined();
    const refresh = cookie(r, COOKIE_REFRESH)!.value;
    const config = await app.inject({ method: 'POST', url: CAMINHO_ENTRAR_PELO_BKO, headers: CSRF, cookies: { [COOKIE_REFRESH]: refresh } });
    expect(config.statusCode, config.body).toBe(200);
    SessaoPlataformaResposta.parse(config.json());
    const eu = await app.inject({ url: `${PREFIXO_PLATAFORMA}/auth/eu`, cookies: { [COOKIE_CONFIG]: cookie(config, COOKIE_CONFIG)!.value } });
    expect(eu.statusCode, eu.body).toBe(200);
  });

  it('§7: mesmo e-mail, senha do superadmin: 401 NAO_AUTENTICADO genérico, sem cookie nenhum e sem falha no superadmin', async () => {
    const r = await login(DUPLO, SENHA_SA);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual(NEUTRO_401);
    expect(cookie(r, COOKIE_CONFIG)).toBeUndefined();
    expect(cookie(r, COOKIE_REFRESH)).toBeUndefined();
    const [sa] = (await b.admin.query<{ falhas_login: number }>('SELECT falhas_login FROM plataforma.superadmin WHERE email = $1', [DUPLO])).rows;
    expect(sa!.falhas_login).toBe(0);
  });

  it('§5: e-mail só de superadmin: destino config com o cookie do /config, sem o refresh do BKO', async () => {
    const r = await login(SO_SUPERADMIN, SENHA_SA);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    expect(cookie(r, COOKIE_CONFIG)).toMatchObject({ path: PREFIXO_PLATAFORMA, httpOnly: true });
    expect(cookie(r, COOKIE_REFRESH)).toBeUndefined();
  });

  it('§3: empresa suspensa: senha errada = 401 genérico; senha certa = 403 EMPRESA_SUSPENSA sem sessão', async () => {
    const errada = await login(DA_SUSPENSA, 'errada-1');
    expect([errada.statusCode, errada.json()]).toEqual([401, NEUTRO_401]);
    const certa = await login(DA_SUSPENSA, SENHA_DE_TESTE);
    expect(certa.statusCode).toBe(403);
    expect(certa.json()).toEqual({ codigo: CODIGO_EMPRESA_SUSPENSA, mensagem: MENSAGEM_EMPRESA_SUSPENSA });
    expect(certa.cookies).toEqual([]);
  });

  it('§2: empresa encerrada = e-mail inexistente (o mesmo 401)', async () => {
    for (const email of [DA_ENCERRADA, 'ninguem@login-email.teste']) {
      const r = await login(email, SENHA_DE_TESTE);
      expect([r.statusCode, r.json()], email).toEqual([401, NEUTRO_401]);
    }
  });
});
