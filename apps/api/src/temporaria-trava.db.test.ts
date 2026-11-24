/**
 * Hotfix (regra do Alexandre: "Quando eu clicar em esqueci a senha, é para desbloquear o usuario. para eu tentar com a
 * senha temporaria") no PostgreSQL migrado, com os adaptadores de produção no papel `macuxierp_app`:
 * - com a conta travada, só a temporária é conferida; vigente = consumo atômico que zera `falhas_login` e
 *   `bloqueado_ate` e sessão com a troca de motivo 'temporaria';
 * - errada, vencida ou ausente = a resposta da trava de sempre (tenant 429, superadmin 401 neutro), sem somar falha nem
 *   estender a trava; a senha atual certa segue barrada.
 * Tenant: o consumo é o UPDATE do `auth/repositorio-pg.ts`. Superadmin: depende da 0051 (a `superadmin_consumir_temporaria`
 * zera a trava; sem ela a `superadmin_abrir_sessao` da 0033 dá MXS01); o teste do superadmin travado que entra só roda
 * quando a função instalada zera a trava (`consumoZeraTrava`, lido do `pg_get_functiondef`).
 */
import { randomUUID } from 'node:crypto';
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';

const TEMPORARIA = 'Temp-Abc23xyz!Q';
const ERRADA = 'Temp-errada-9!';
const NEUTRO_401 = { codigo: 'NAO_AUTENTICADO', mensagem: 'Empresa, e-mail ou senha inválidos' };

describe.skipIf(!PG_DISPONIVEL)('hotfix: a temporária entra com a conta travada e zera a trava (PostgreSQL)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let hashTemporaria: string;
  let consumoZeraTrava = false;
  let ip = 10;
  const novoIp = () => `10.2.0.${ip++}`;
  const entrar = (empresa: string, email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', headers: { [CABECALHO_CSRF_CONFIG]: '1', 'cf-connecting-ip': novoIp() }, payload: { empresa, email, senha } });

  type Tabela = 'usuario' | 'superadmin';
  /** Trava a conta (5 falhas, 15 min) e põe a temporária (vigente, vencida ou nenhuma). */
  const preparar = async (tabela: Tabela, email: string, temporaria: 'vigente' | 'vencida' | 'nenhuma') =>
    b.admin.query(
      `UPDATE plataforma.${tabela} SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes', deve_trocar_senha = false,
         senha_temporaria_hash = $2, senha_temporaria_expira_em = CASE $3 WHEN 'vigente' THEN now() + interval '72 hours'
           WHEN 'vencida' THEN now() - interval '1 second' END
       WHERE email = $1`,
      [email, temporaria === 'nenhuma' ? null : hashTemporaria, temporaria],
    );
  const estado = async (tabela: Tabela, email: string) =>
    (
      await b.admin.query<{ falhas_login: number; bloqueado_ate: Date | null; temporaria: boolean; deve_trocar_senha: boolean }>(
        `SELECT falhas_login, bloqueado_ate, senha_temporaria_hash IS NOT NULL AS temporaria, deve_trocar_senha FROM plataforma.${tabela} WHERE email = $1`,
        [email],
      )
    ).rows[0]!;

  const EMAIL = 'adm@loja-trava.teste';
  const EMAIL_SA = 'sa-trava-temporaria@exemplo.invalid';

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const tenant = await criarTenant(b.admin, 'am2808', ['cadastros']);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: EMAIL, nome: 'Administradora', filialIds: [] });
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO),
    ]);
    hashTemporaria = await gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
    const def = await b.admin.query<{ d: string }>(`SELECT pg_get_functiondef('plataforma.superadmin_consumir_temporaria(uuid)'::regprocedure) AS d`);
    consumoZeraTrava = /bloqueado_ate\s*=\s*NULL/i.test(def.rows[0]!.d);
    ({ app } = await appPgDeTeste({ b }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('tenant travado com a temporária vigente: 200 bko com a troca de motivo temporaria; o UPDATE do consumo zera a trava', async () => {
    await preparar('usuario', EMAIL, 'vigente');
    const r = await entrar('AM2808', EMAIL, TEMPORARIA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ destino: 'bko', token_acesso: expect.any(String), expira_em: expect.any(String) });
    expect(await estado('usuario', EMAIL)).toEqual({ falhas_login: 0, bloqueado_ate: null, temporaria: false, deve_trocar_senha: true });
    const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${r.json<{ token_acesso: string }>().token_acesso}` } });
    expect(eu.json().usuario).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
  });

  it('tenant travado: sem temporária, com a senha atual certa, com a temporária errada e com a vencida = o mesmo 429, sem somar falha nem estender a trava', async () => {
    await preparar('usuario', EMAIL, 'nenhuma');
    const sem = await entrar('AM2808', EMAIL, TEMPORARIA);
    expect(sem.statusCode).toBe(429);
    expect(sem.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS' });
    await preparar('usuario', EMAIL, 'vigente');
    const travada = await estado('usuario', EMAIL);
    const atual = await entrar('AM2808', EMAIL, SENHA_DE_TESTE);
    const errada = await entrar('AM2808', EMAIL, ERRADA);
    expect(await estado('usuario', EMAIL)).toEqual(travada);
    await preparar('usuario', EMAIL, 'vencida');
    const vencida = await entrar('AM2808', EMAIL, TEMPORARIA);
    for (const r of [atual, errada, vencida]) {
      expect(r.statusCode).toBe(429);
      expect(r.body).toBe(sem.body);
    }
    expect(await estado('usuario', EMAIL)).toMatchObject({ falhas_login: 5, temporaria: true, deve_trocar_senha: false });
  });

  it('superadmin travado: sem temporária, com a senha atual certa, com a temporária errada e com a vencida = o mesmo 401 neutro, sem somar falha nem estender a trava', async () => {
    await preparar('superadmin', EMAIL_SA, 'nenhuma');
    const sem = await entrar('MACUXI', EMAIL_SA, TEMPORARIA);
    await preparar('superadmin', EMAIL_SA, 'vigente');
    const travada = await estado('superadmin', EMAIL_SA);
    const atual = await entrar('MACUXI', EMAIL_SA, SENHA_DE_TESTE);
    const errada = await entrar('MACUXI', EMAIL_SA, ERRADA);
    expect(await estado('superadmin', EMAIL_SA)).toEqual(travada);
    await preparar('superadmin', EMAIL_SA, 'vencida');
    const vencida = await entrar('MACUXI', EMAIL_SA, TEMPORARIA);
    for (const r of [sem, atual, errada, vencida]) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toBe(JSON.stringify(NEUTRO_401));
      expect(r.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
    }
    expect(await estado('superadmin', EMAIL_SA)).toMatchObject({ falhas_login: 5, temporaria: true, deve_trocar_senha: false });
  });

  it('superadmin travado com a temporária vigente: 200 config com a troca de motivo temporaria; o consumo (0051) zera a trava', async (ctx) => {
    if (!consumoZeraTrava) ctx.skip();
    await preparar('superadmin', EMAIL_SA, 'vigente');
    const r = await entrar('MACUXI', EMAIL_SA, TEMPORARIA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    expect(await estado('superadmin', EMAIL_SA)).toEqual({ falhas_login: 0, bloqueado_ate: null, temporaria: false, deve_trocar_senha: true });
    const cookie = r.cookies.find((c) => c.name === COOKIE_CONFIG)!.value;
    const eu = await app.inject({ url: '/v1/plataforma/auth/eu', cookies: { [COOKIE_CONFIG]: cookie } });
    expect(eu.json()).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
  });
});
