/**
 * T-0052 (RN-CORE-10, regra única do SDK) ponta a ponta no PostgreSQL (`appPgDeTeste` de produção, RLS): senha provisória
 * do portal /config e do operador.sh criar-empresa, corpos de erro, limites da regra (a mesma de 8 no tenant e no superadmin) e senhas antigas.
 * NÃO se repete: o guard puro, a troca certa com auditoria e a senha atual errada (apps/api/src/troca-senha.db.test.ts),
 * a 0036 (db/testes/deve-trocar-senha-0036.db.test.ts), o gerador e o empresa.mjs (apps/api/src/operador-*.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CODIGO_TROCAR_SENHA,
  MENSAGEM_SENHA_FORA_DA_REGRA,
  MENSAGEM_SENHA_IGUAL,
  regrasDescumpridas,
  type RegraSenhaId,
} from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, ARGON2_RAPIDO } from '../../../apps/api/src/apoio-teste';
import { envPsqlAdmin } from '../../../apps/api/src/apoio-operador-teste';
import { COOKIE_REFRESH } from '../../../apps/api/src/app';
import { gerarHashSenha } from '../../../apps/api/src/auth/senha';
import { MENSAGEM_TROCAR_SENHA } from '../../../apps/api/src/auth/troca-senha';
import { criarDockerFalso } from '../../apoio/operador-falso';
import { atalhosPortal, inserirSuperadmin, novoIp, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OPERADOR_SH = resolve(RAIZ, 'scripts', 'deploy', 'producao', 'operador.sh');
const TEM_ARGON2_NATIVO = Number(process.versions.node.split('.')[0]) * 100 + Number(process.versions.node.split('.')[1]) >= 2407;

const EMAIL_SA = 'sa-t0052@exemplo.invalid';
const SLUG = 't0052-troca';
const EMAIL_ADM = 'adm-t0052@exemplo.invalid';
/** Rota de módulo de leitura que o administrador alcança em qualquer tenant (o core é base, sem licença). */
const ROTA_MODULO = '/v1/core/usuarios';

/** Casos-limite da regra única (os ids na ordem de REGRAS_SENHA e o texto de `campos.senha_nova`). */
const FORA_DA_REGRA: { nome: string; senha: string; regras: RegraSenhaId[]; texto: string }[] = [
  { nome: '7 caracteres', senha: 'abcde1!', regras: ['caracteres'], texto: '8 caracteres ou mais' },
  { nome: 'sem letra', senha: '1234567!', regras: ['letra'], texto: 'Uma letra' },
  { nome: 'sem número', senha: 'abcdefg!', regras: ['numero'], texto: 'Um número' },
  { nome: 'sem especial', senha: 'abcdefg1', regras: ['especial'], texto: 'Um caractere especial' },
  { nome: 'espaço não é especial', senha: 'abcdef1 ', regras: ['especial'], texto: 'Um caractere especial' },
  { nome: 'vazia', senha: '', regras: ['caracteres', 'letra', 'numero', 'especial'], texto: '8 caracteres ou mais; Uma letra; Um número; Um caractere especial' },
];
/** Exatamente 8 caracteres, com letra, número e especial: o limite que passa. */
const OITO = 'abcdef1!';
const OITO_ACENTO = 'çãõéÁ1@x';

describe.skipIf(!PG_DISPONIVEL)('T-0052 (RN-CORE-10): troca obrigatória e regra única de senha, ponta a ponta no PostgreSQL', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  let tokenSa = '';
  let empresa = '';
  let usuario = '';
  let provisoria = '';

  const entrar = (senha: string, o: { slug?: string; email?: string } = {}): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), payload: { empresa: o.slug ?? SLUG, email: o.email ?? EMAIL_ADM, senha } });
  const acesso = (r: RespostaPortal) => r.json<{ token_acesso: string }>().token_acesso;
  const refreshDe = (r: RespostaPortal) => r.cookies.find((c) => c.name === COOKIE_REFRESH)!.value;
  const get = (token: string, url: string): Promise<RespostaPortal> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const renovar = (refresh: string): Promise<RespostaPortal> => app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: refresh } });
  const trocar = (token: string, corpo: object, refresh?: string): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/auth/senha', headers: { authorization: `Bearer ${token}` }, payload: corpo, ...(refresh ? { cookies: { [COOKIE_REFRESH]: refresh } } : {}) });
  const flag = async (id: string) => (await b.admin.query('SELECT deve_trocar_senha FROM plataforma.usuario WHERE id = $1', [id])).rows[0].deve_trocar_senha as boolean;
  const bloqueada = (r: RespostaPortal) => {
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA });
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_SA);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    p = atalhosPortal(app);
    tokenSa = await p.sessao(EMAIL_SA);
    const criada = await p.pedir('POST', '/v1/plataforma/empresas', { token: tokenSa, corpo: { slug: SLUG, nome: 'Empresa Fictícia T-0052' }, chave: randomUUID() });
    expect(criada.statusCode).toBe(201);
    empresa = criada.json<{ id: string }>().id;
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  describe('portal: 1º administrador com a senha provisória', () => {
    it('POST /primeiro-admin grava deve_trocar_senha = true; a senha entregue cumpre a regra e entra no login', async () => {
      const r = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin`, { token: tokenSa, corpo: { email: EMAIL_ADM, nome: 'Pessoa Fictícia T-0052' }, chave: randomUUID() });
      expect(r.statusCode).toBe(201);
      ({ usuario_id: usuario, senha_provisoria: provisoria } = r.json<{ usuario_id: string; senha_provisoria: string }>());
      expect(regrasDescumpridas(provisoria)).toEqual([]);
      expect(await flag(usuario)).toBe(true);
      expect((await entrar(provisoria)).statusCode).toBe(200);
    });

    it('com a flag: /eu responde (deve_trocar_senha: true), a rota de módulo é 403 TROCAR_SENHA', async () => {
      const t = acesso(await entrar(provisoria));
      const eu = await get(t, '/v1/auth/eu');
      expect(eu.statusCode).toBe(200);
      expect(eu.json()).toMatchObject({ usuario: { id: usuario, deve_trocar_senha: true } });
      bloqueada(await get(t, ROTA_MODULO));
    });

    it('refresh com a flag: 200 (fora do guard), e o acesso novo continua com a flag (403 TROCAR_SENHA)', async () => {
      const login = await entrar(provisoria);
      const r = await renovar(refreshDe(login));
      expect(r.statusCode).toBe(200);
      bloqueada(await get(acesso(r), ROTA_MODULO));
    });

    it('sair com a flag: 204 e o refresh da sessão cai (401)', async () => {
      const login = await entrar(provisoria);
      const sair = await app.inject({ method: 'POST', url: '/v1/auth/sair', headers: { authorization: `Bearer ${acesso(login)}` }, cookies: { [COOKIE_REFRESH]: refreshDe(login) } });
      expect(sair.statusCode).toBe(204);
      expect((await renovar(refreshDe(login))).statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/senha: erros fixados e a regra no tenant', () => {
    it.each(FORA_DA_REGRA)('$nome: 400 VALIDACAO com campos.senha_nova e detalhes.regras; a flag continua', async ({ senha, regras, texto }) => {
      const t = acesso(await entrar(provisoria));
      const r = await trocar(t, { senha_atual: provisoria, senha_nova: senha });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: MENSAGEM_SENHA_FORA_DA_REGRA, campos: { senha_nova: texto }, detalhes: { regras } });
      expect(await flag(usuario)).toBe(true);
    });

    it('a regra vem antes da senha atual: atual errada + nova fora da regra = o 400 da regra', async () => {
      const t = acesso(await entrar(provisoria));
      const r = await trocar(t, { senha_atual: 'nao-e-a-atual-1!', senha_nova: 'abc' });
      expect(r.json()).toMatchObject({ codigo: 'VALIDACAO', mensagem: MENSAGEM_SENHA_FORA_DA_REGRA, detalhes: { regras: ['caracteres', 'numero', 'especial'] } });
    });

    it('nova igual à atual: 400 VALIDACAO em campos.senha_nova', async () => {
      const t = acesso(await entrar(provisoria));
      const r = await trocar(t, { senha_atual: provisoria, senha_nova: provisoria });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { senha_nova: MENSAGEM_SENHA_IGUAL } });
    });

    it('sem corpo e sem sessão: 400 VALIDACAO e 401 NAO_AUTENTICADO', async () => {
      const t = acesso(await entrar(provisoria));
      const semCorpo = await trocar(t, {});
      expect(semCorpo.statusCode).toBe(400);
      expect(semCorpo.json()).toMatchObject({ codigo: 'VALIDACAO' });
      const semSessao = await app.inject({ method: 'POST', url: '/v1/auth/senha', payload: { senha_atual: provisoria, senha_nova: OITO } });
      expect(semSessao.statusCode).toBe(401);
      expect(await flag(usuario)).toBe(true);
    });
  });

  describe('troca certa no limite de 8 caracteres (o resto da troca certa: apps/api/src/troca-senha.db.test.ts)', () => {
    it('204 com 8 caracteres exatos; o JWT de acesso antigo segue com a flag até vencer; o renovado passa', async () => {
      const a = await entrar(provisoria);
      expect((await trocar(acesso(a), { senha_atual: provisoria, senha_nova: OITO }, refreshDe(a))).statusCode).toBe(204);
      // o JWT de acesso já emitido carrega `dts` até vencer (15 min): o BKO renova para sair dele (comentário do app.ts)
      bloqueada(await get(acesso(a), ROTA_MODULO));
      expect((await get(acesso(await renovar(refreshDe(a))), ROTA_MODULO)).statusCode).toBe(200);
      expect((await entrar(OITO)).statusCode).toBe(200);
    });

    it('troca sem o cookie de refresh (sem sessão corrente): todas as sessões do usuário caem', async () => {
      const a = await entrar(OITO);
      const r = await trocar(acesso(a), { senha_atual: OITO, senha_nova: OITO_ACENTO });
      expect(r.statusCode).toBe(204);
      expect((await renovar(refreshDe(a))).statusCode).toBe(401);
      expect((await entrar(OITO_ACENTO)).statusCode).toBe(200);
    });
  });

  describe('portal: redefinir a senha do 1º administrador religa a troca', () => {
    it('POST /primeiro-admin/senha: deve_trocar_senha volta a true; o login cai em TROCAR_SENHA até trocar de novo', async () => {
      expect(await flag(usuario)).toBe(false);
      const r = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin/senha`, { token: tokenSa, chave: randomUUID() });
      expect(r.statusCode).toBe(200);
      const nova = r.json<{ senha_provisoria: string }>().senha_provisoria;
      expect(regrasDescumpridas(nova)).toEqual([]);
      expect(await flag(usuario)).toBe(true);

      const login = await entrar(nova);
      expect(login.statusCode).toBe(200);
      bloqueada(await get(acesso(login), ROTA_MODULO));
      expect((await trocar(acesso(login), { senha_atual: nova, senha_nova: 'Outra-senha-2' }, refreshDe(login))).statusCode).toBe(204);
      expect((await get(acesso(await renovar(refreshDe(login))), ROTA_MODULO)).statusCode).toBe(200);
    });
  });

  describe('senhas já gravadas fora da regra continuam valendo (a regra não é conferida no login)', () => {
    it.each(['abc', 'semnumero', '12345678'])('usuário do tenant com a senha antiga "%s" entra e a usa como senha atual na troca', async (antiga) => {
      const id = randomUUID();
      const email = `antiga-${antiga}@exemplo.invalid`;
      await b.admin.query(
        `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids) VALUES ($1, $2, $3, 'Pessoa Fictícia Antiga', $4, 'administrador', '{}')`,
        [id, empresa, email, await gerarHashSenha(antiga, ARGON2_RAPIDO)],
      );
      expect(regrasDescumpridas(antiga).length).toBeGreaterThan(0);
      const login = await entrar(antiga, { email });
      expect(login.statusCode).toBe(200);
      expect((await get(acesso(login), ROTA_MODULO)).statusCode).toBe(200);
      expect((await trocar(acesso(login), { senha_atual: antiga, senha_nova: OITO }, refreshDe(login))).statusCode).toBe(204);
      expect((await entrar(OITO, { email })).statusCode).toBe(200);
    });
  });

  describe('superadmin: POST /v1/plataforma/auth/senha com a mesma regra de 8', () => {
    const EMAIL = 'sa-t0052-regra@exemplo.invalid';
    const ANTIGA_SA = 'senhaantigadosuperadmin';
    let token = '';
    const trocarSa = (corpo: object): Promise<RespostaPortal> => p.pedir('POST', '/v1/plataforma/auth/senha', { token, corpo });

    beforeAll(async () => {
      // senha antiga fora da regra (sem número nem especial), gravada como faria uma versão anterior: o login entra
      expect(regrasDescumpridas(ANTIGA_SA)).toEqual(['numero', 'especial']);
      await b.admin.query(
        `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin Fictício T-0052', $2, true, true)`,
        [EMAIL, await gerarHashSenha(ANTIGA_SA, ARGON2_RAPIDO)],
      );
      token = await p.sessao(EMAIL, ANTIGA_SA);
    });

    it('com a flag: /auth/eu responde, a rota do portal é 403 TROCAR_SENHA', async () => {
      expect((await p.pedir('GET', '/v1/plataforma/auth/eu', { token })).json()).toMatchObject({ deve_trocar_senha: true });
      const r = await p.pedir('GET', '/v1/plataforma/empresas', { token });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ codigo: CODIGO_TROCAR_SENHA });
    });

    it.each(FORA_DA_REGRA.slice(0, 1))('$nome: 400 com o mesmo corpo da troca do tenant (os 6 casos estão no tenant)', async ({ senha, regras, texto }) => {
      const r = await trocarSa({ senha_atual: ANTIGA_SA, senha_nova: senha });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: MENSAGEM_SENHA_FORA_DA_REGRA, campos: { senha_nova: texto }, detalhes: { regras } });
    });

    it('8 caracteres (não 14): 204, a flag zera e as rotas do portal voltam; a nova entra', async () => {
      const r = await trocarSa({ senha_atual: ANTIGA_SA, senha_nova: OITO });
      expect(r.statusCode).toBe(204);
      const nova = await p.sessao(EMAIL, OITO);
      expect((await p.pedir('GET', '/v1/plataforma/auth/eu', { token: nova })).json()).toMatchObject({ deve_trocar_senha: false });
      expect((await p.pedir('GET', '/v1/plataforma/empresas', { token: nova })).statusCode).toBe(200);
      expect((await p.entrar(EMAIL, ANTIGA_SA)).statusCode).toBe(401);
    });
  });

  describe.skipIf(!TEM_ARGON2_NATIVO)('operador.sh criar-empresa: a senha impressa cumpre a regra e cai em TROCAR_SENHA', () => {
    const CODIGO_OP = 'AM0001'; // fictício, UF + 4 dígitos (RN-CORE-11)
    const SLUG_OP = CODIGO_OP.toLowerCase(); // o operador grava o código em minúsculas em plataforma.tenant.slug
    const EMAIL_OP = 'adm-t0052-operador@exemplo.invalid';
    let pasta = '';
    let bin = '';
    let erp = '';

    beforeAll(() => {
      pasta = mkdtempSync(join(tmpdir(), 'macuxierp-t0052-operador-'));
      ({ bin, erp } = criarDockerFalso(pasta));
    });
    afterAll(() => {
      if (pasta) rmSync(pasta, { recursive: true, force: true });
    });

    it('com --confirmar: imprime a senha uma vez; ela cumpre a regra, entra com deve_trocar_senha e a troca libera as rotas', async () => {
      const r = spawnSync(
        'bash',
        [OPERADOR_SH, 'criar-empresa', '--codigo', CODIGO_OP, '--nome', 'Empresa Fictícia Operador T-0052', '--admin-email', EMAIL_OP, '--operador', 'alexandre', '--confirmar'],
        {
          env: { ...envPsqlAdmin(b.nome), PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: pasta, MACUXIERP_DIR: erp, NODE_REAL: process.execPath },
          input: '',
          encoding: 'utf8',
          timeout: 120_000,
        },
      );
      const saida = `${r.stdout}${r.stderr}`;
      expect(r.status, saida.split('\n').filter((l) => !l.includes('@')).slice(-5).join('\n')).toBe(0);
      const linhas = saida.split('\n');
      const i = linhas.findIndex((l) => l.startsWith('Senha provisória do administrador'));
      expect(i).toBeGreaterThanOrEqual(0);
      const senha = linhas[i + 1]!.trim();
      expect(senha).toHaveLength(16);
      expect(regrasDescumpridas(senha)).toEqual([]);

      const { rows } = await b.admin.query('SELECT u.id, u.deve_trocar_senha FROM plataforma.usuario u JOIN plataforma.tenant t ON t.id = u.tenant_id WHERE t.slug = $1', [SLUG_OP]);
      expect(rows).toHaveLength(1);
      expect(rows[0].deve_trocar_senha).toBe(true);

      const login = await entrar(senha, { slug: SLUG_OP, email: EMAIL_OP });
      expect(login.statusCode).toBe(200);
      bloqueada(await get(acesso(login), ROTA_MODULO));
      expect((await trocar(acesso(login), { senha_atual: senha, senha_nova: OITO }, refreshDe(login))).statusCode).toBe(204);
      expect(await flag(rows[0].id)).toBe(false);
      expect((await get(acesso(await renovar(refreshDe(login))), ROTA_MODULO)).statusCode).toBe(200);
    });
  });
});
