/**
 * Portal `/config` na API (T-0050, ADR 0012) contra o PostgreSQL migrado com a 0033, com as dependências de produção
 * (`appPgDeTeste`): login do superadmin (cookie próprio, trava, limite por IP, mensagem única), anti-CSRF nas escritas,
 * plugin de plataforma do core em `/v1/plataforma/*` (idempotência pelas funções da 0033, senha provisória sem guarda,
 * SQLSTATE → HTTP) e a regressão das rotas de tenant. Superadmins criados pelo admin do banco de teste. Dados fictícios.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_RAPIDO, appPgDeTeste, destinoDeLogs, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';
import { LIMITE_LOGIN_IP_PADRAO } from './plataforma/limite-ip';
import { FALHA_LOGIN_PLATAFORMA } from './plataforma/servico';

const SENHA_SA = 'senha-do-superadmin-de-teste';
const SENHA_NOVA = 'senha-nova-do-superadmin-123';
const EMAIL_SA = 'sa-portal@exemplo.invalid';
const EMAIL_TRAVA = 'sa-trava@exemplo.invalid';
const EMAIL_TROCA = 'sa-troca@exemplo.invalid';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };

/** Cada teste de login sai de um IP próprio: o limite por IP (`LIMITE_LOGIN_IP_PADRAO`) não vaza entre os testes. */
let ipSeq = 10;
const novoIp = () => `10.0.0.${ipSeq++}`;

describe.skipIf(!PG_DISPONIVEL)('portal /config na API (T-0050, ADR 0012)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  const logs: string[] = [];

  async function inserirSuperadmin(email: string, deveTrocar: boolean): Promise<void> {
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, $3, true)`,
      [email, await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO), deveTrocar],
    );
  }

  const entrar = (email: string, senha: string, ip = novoIp(), cabecalhos: Record<string, string> = CSRF) =>
    app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', remoteAddress: ip, headers: cabecalhos, payload: { email, senha } });

  function cookieDe(r: LightMyRequestResponse): string {
    const c = r.cookies.find((x) => x.name === COOKIE_CONFIG);
    if (!c) throw new Error('login sem cookie');
    return c.value;
  }

  async function sessao(email = EMAIL_SA, senha = SENHA_SA): Promise<string> {
    const r = await entrar(email, senha);
    expect(r.statusCode).toBe(200);
    return cookieDe(r);
  }

  const pedir = (token: string, metodo: 'GET' | 'POST' | 'PUT', url: string, o: { corpo?: unknown; chave?: string; csrf?: boolean } = {}) =>
    app.inject({
      method: metodo,
      url,
      cookies: { [COOKIE_CONFIG]: token },
      headers: { ...(o.csrf === false ? {} : CSRF), ...(o.chave ? { 'idempotency-key': o.chave } : {}) },
      ...(o.corpo !== undefined ? { payload: o.corpo as Record<string, unknown> } : {}),
    });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(EMAIL_SA, false);
    await inserirSuperadmin(EMAIL_TRAVA, false);
    await inserirSuperadmin(EMAIL_TROCA, true);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logs) } }));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('login certo: cookie próprio HttpOnly, Secure, SameSite=Strict, Path=/v1/plataforma, sem token no corpo e no-store', async () => {
    const r = await entrar(EMAIL_SA, SENHA_SA);
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const corpo = r.json<{ expira_em: string }>();
    expect(Object.keys(corpo)).toEqual(['expira_em']);
    const c = r.cookies.find((x) => x.name === COOKIE_CONFIG)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/plataforma' });
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // só o hash do token vai ao banco
    const { rows } = await b.admin.query('SELECT count(*)::int n FROM plataforma.sessao_superadmin WHERE token_hash = $1', [c.value]);
    expect(rows[0].n).toBe(0);
    const eu = await pedir(c.value, 'GET', '/v1/plataforma/auth/eu');
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toMatchObject({ superadmin: { nome: 'Superadmin de teste' }, deve_trocar_senha: false, sessao_expira_em: corpo.expira_em });
  });

  it('senha errada e e-mail inexistente: 401 com a mesma mensagem, sem dizer qual errou', async () => {
    const errada = await entrar(EMAIL_SA, 'senha-errada');
    const inexistente = await entrar('ninguem@exemplo.invalid', SENHA_SA);
    expect(errada.statusCode).toBe(401);
    expect(inexistente.statusCode).toBe(401);
    expect(errada.json()).toEqual(inexistente.json());
    expect(errada.json<{ mensagem: string }>().mensagem).toBe(FALHA_LOGIN_PLATAFORMA);
    expect(errada.cookies.find((x) => x.name === COOKIE_CONFIG)).toBeUndefined();
  });

  it('trava: 5 falhas seguidas travam a conta; a senha certa também recebe a mensagem única', async () => {
    for (let i = 0; i < 5; i++) expect((await entrar(EMAIL_TRAVA, `errada-${i}`)).statusCode).toBe(401);
    const { rows } = await b.admin.query('SELECT falhas_login, bloqueado_ate > now() AS travado FROM plataforma.superadmin WHERE email = $1', [EMAIL_TRAVA]);
    expect(rows[0]).toMatchObject({ falhas_login: 5, travado: true });
    const certa = await entrar(EMAIL_TRAVA, SENHA_SA);
    expect(certa.statusCode).toBe(401);
    expect(certa.json<{ mensagem: string }>().mensagem).toBe(FALHA_LOGIN_PLATAFORMA);
  });

  it('limite por IP: a 11ª tentativa em 15 min do mesmo IP é 429, mesmo com a senha certa', async () => {
    const ip = novoIp();
    for (let i = 0; i < LIMITE_LOGIN_IP_PADRAO.maximo; i++) expect((await entrar('outro@exemplo.invalid', 'x', ip)).statusCode).toBe(401);
    const r = await entrar(EMAIL_SA, SENHA_SA, ip);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS' });
    expect((await entrar(EMAIL_SA, SENHA_SA)).statusCode).toBe(200); // outro IP segue
  });

  it('anti-CSRF: escrita sem o cabeçalho x-macuxierp-config é 403, inclusive o login; leitura não exige', async () => {
    expect((await entrar(EMAIL_SA, SENHA_SA, novoIp(), {})).statusCode).toBe(403);
    const token = await sessao();
    const r = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { slug: 'csrf-a', nome: 'Empresa CSRF' }, chave: randomUUID(), csrf: false });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'ORIGEM_RECUSADA' });
    expect((await pedir(token, 'GET', '/v1/plataforma/empresas', { csrf: false })).statusCode).toBe(200);
    const { rows } = await b.admin.query("SELECT count(*)::int n FROM plataforma.tenant WHERE slug = 'csrf-a'");
    expect(rows[0].n).toBe(0);
  });

  it('sessão inválida: sem cookie, cookie forjado e JWT de tenant em /v1/plataforma são 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas' })).statusCode).toBe(401);
    expect((await pedir('A'.repeat(43), 'GET', '/v1/plataforma/empresas')).statusCode).toBe(401);
    expect((await pedir('curto', 'GET', '/v1/plataforma/auth/eu')).statusCode).toBe(401);
    const t = await criarTenant(b.admin, 'portal-jwt', ['core']);
    await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email: 'adm@exemplo.invalid', nome: 'Pessoa Fictícia', filialIds: [] });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'portal-jwt', email: 'adm@exemplo.invalid', senha: SENHA_DE_TESTE } });
    expect(login.statusCode).toBe(200);
    const jwt = login.json<{ token_acesso: string }>().token_acesso;
    const r = await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: { authorization: `Bearer ${jwt}` } });
    expect(r.statusCode).toBe(401);
    // e o cookie do portal não vale nas rotas de tenant
    const token = await sessao();
    expect((await app.inject({ method: 'GET', url: '/v1/auth/eu', cookies: { [COOKIE_CONFIG]: token } })).statusCode).toBe(401);
  });

  it('criar empresa: 201 com só o core; a mesma Idempotency-Key devolve a mesma resposta sem criar outra', async () => {
    const token = await sessao();
    const chave = randomUUID();
    const corpo = { slug: 'portal-api-a', nome: 'Empresa Portal API' };
    const r1 = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo, chave });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ slug: 'portal-api-a', situacao: 'ativo', modulos: [{ modulo: 'core', ativo: true }], primeiro_admin: null });
    const r2 = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo, chave });
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotency-replayed']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    // a chave com outro corpo é 409
    expect((await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { ...corpo, slug: 'portal-api-b' }, chave })).statusCode).toBe(409);
    const { rows } = await b.admin.query("SELECT count(*)::int n FROM plataforma.tenant WHERE slug = 'portal-api-a'");
    expect(rows[0].n).toBe(1);
    // guardada no tenant de referência, pelas funções da 0033
    const idem = await b.admin.query('SELECT tenant_id = plataforma.tenant_referencia() AS ref, status FROM plataforma.idempotencia WHERE chave = $1', [chave]);
    expect(idem.rows).toEqual([{ ref: true, status: 201 }]);
    // sem a Idempotency-Key: 400
    expect((await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { ...corpo, slug: 'portal-api-c' } })).statusCode).toBe(400);
  });

  it('1º admin: 201 com a senha provisória e no-store, sem corpo guardado; o reenvio da mesma chave é 409 sem a senha', async () => {
    const token = await sessao();
    const criada = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { slug: 'portal-api-adm', nome: 'Empresa Admin' }, chave: randomUUID() });
    const id = criada.json<{ id: string }>().id;
    const chave = randomUUID();
    const corpo = { email: 'primeiro@exemplo.invalid', nome: 'Pessoa Fictícia' };
    const r1 = await pedir(token, 'POST', `/v1/plataforma/empresas/${id}/primeiro-admin`, { corpo, chave });
    expect(r1.statusCode).toBe(201);
    expect(r1.headers['cache-control']).toBe('no-store');
    expect(r1.headers.pragma).toBe('no-cache');
    const senha = r1.json<{ senha_provisoria: string }>().senha_provisoria;
    expect(senha.length).toBeGreaterThanOrEqual(16);
    const { rows } = await b.admin.query('SELECT status, resposta FROM plataforma.idempotencia WHERE chave = $1', [chave]);
    expect(rows).toEqual([{ status: 201, resposta: null }]);
    const r2 = await pedir(token, 'POST', `/v1/plataforma/empresas/${id}/primeiro-admin`, { corpo, chave });
    expect(r2.statusCode).toBe(409);
    expect(r2.body).not.toContain(senha);
    // outra chave: a empresa já tem administrador (409)
    expect((await pedir(token, 'POST', `/v1/plataforma/empresas/${id}/primeiro-admin`, { corpo, chave: randomUUID() })).statusCode).toBe(409);
  });

  it('empresa inexistente é 404; slug repetido é 409', async () => {
    const token = await sessao();
    expect((await pedir(token, 'GET', `/v1/plataforma/empresas/${randomUUID()}`)).statusCode).toBe(404);
    const r = await pedir(token, 'PUT', `/v1/plataforma/empresas/${randomUUID()}/situacao`, { corpo: { situacao: 'suspenso', motivo: 'teste de inexistente' } });
    expect(r.statusCode).toBe(404);
    const corpo = { slug: 'portal-api-rep', nome: 'Empresa Repetida' };
    expect((await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo, chave: randomUUID() })).statusCode).toBe(201);
    const rep = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo, chave: randomUUID() });
    expect(rep.statusCode).toBe(409);
    expect(rep.json()).toMatchObject({ codigo: 'CONFLITO' });
  });

  it('regras: fuso desconhecido (23514 da função) é 422 com mensagem fixa; faturamento sem fiscal é 422 RN-CORE-02; core desligado é recusado', async () => {
    const token = await sessao();
    const fuso = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { slug: 'portal-api-fuso', nome: 'Empresa Fuso', fuso: 'America/Lugar_Nenhum' }, chave: randomUUID() });
    expect(fuso.statusCode).toBe(422);
    expect(fuso.json()).toEqual({ codigo: 'REGRA_PLATAFORMA', mensagem: 'Pedido recusado pelas regras da plataforma' });
    const criada = await pedir(token, 'POST', '/v1/plataforma/empresas', { corpo: { slug: 'portal-api-mod', nome: 'Empresa Módulos' }, chave: randomUUID() });
    const id = criada.json<{ id: string }>().id;
    const fat = await pedir(token, 'PUT', `/v1/plataforma/empresas/${id}/modulos`, { corpo: { modulos: [{ modulo: 'faturamento', ativo: true }] } });
    expect(fat.statusCode).toBe(422);
    expect(fat.json()).toMatchObject({ codigo: 'RN-CORE-02' });
    // o contrato (AlterarModulosEntrada) já recusa o core desligado antes da função: 400 VALIDACAO
    const core = await pedir(token, 'PUT', `/v1/plataforma/empresas/${id}/modulos`, { corpo: { modulos: [{ modulo: 'core', ativo: false }] } });
    expect(core.statusCode).toBe(400);
    const todos = ['cadastros', 'pedido', 'fiscal', 'faturamento'].map((modulo) => ({ modulo, ativo: true }));
    const ok = await pedir(token, 'PUT', `/v1/plataforma/empresas/${id}/modulos`, { corpo: { modulos: todos } });
    expect(ok.statusCode).toBe(200);
    // desligar o fiscal com o faturamento ligado também é RN-CORE-02
    const desl = await pedir(token, 'PUT', `/v1/plataforma/empresas/${id}/modulos`, { corpo: { modulos: [{ modulo: 'fiscal', ativo: false }] } });
    expect(desl.json()).toMatchObject({ codigo: 'RN-CORE-02' });
  });

  it('troca de senha pendente: só eu, senha e sair respondem (403 TROCAR_SENHA); a troca revoga as outras sessões', async () => {
    const t1 = await sessao(EMAIL_TROCA);
    const t2 = await sessao(EMAIL_TROCA);
    expect((await pedir(t1, 'GET', '/v1/plataforma/auth/eu')).json()).toMatchObject({ deve_trocar_senha: true });
    const bloqueada = await pedir(t1, 'GET', '/v1/plataforma/empresas');
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json()).toMatchObject({ codigo: 'TROCAR_SENHA' });
    const errada = await pedir(t1, 'POST', '/v1/plataforma/auth/senha', { corpo: { senha_atual: 'nao-e-esta', senha_nova: SENHA_NOVA } });
    expect(errada.statusCode).toBe(400);
    expect((await pedir(t1, 'POST', '/v1/plataforma/auth/senha', { corpo: { senha_atual: SENHA_SA, senha_nova: SENHA_NOVA }, csrf: false })).statusCode).toBe(403);
    expect((await pedir(t1, 'POST', '/v1/plataforma/auth/senha', { corpo: { senha_atual: SENHA_SA, senha_nova: SENHA_NOVA } })).statusCode).toBe(204);
    expect((await pedir(t1, 'GET', '/v1/plataforma/empresas')).statusCode).toBe(200);
    expect((await pedir(t2, 'GET', '/v1/plataforma/auth/eu')).statusCode).toBe(401); // a outra sessão caiu
    expect((await entrar(EMAIL_TROCA, SENHA_SA)).statusCode).toBe(401);
    expect((await entrar(EMAIL_TROCA, SENHA_NOVA)).statusCode).toBe(200);
  });

  it('sair: 204, apaga o cookie e revoga a sessão no banco; sem sessão também é 204', async () => {
    const token = await sessao();
    const r = await pedir(token, 'POST', '/v1/plataforma/auth/sair');
    expect(r.statusCode).toBe(204);
    expect(r.cookies.find((x) => x.name === COOKIE_CONFIG)?.value).toBe('');
    expect((await pedir(token, 'GET', '/v1/plataforma/auth/eu')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/auth/sair', headers: CSRF })).statusCode).toBe(204);
  });

  it('regressão das rotas de tenant: saúde, login e /v1/<modulo> seguem iguais', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/saude' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/core/usuarios' })).statusCode).toBe(401);
    const t = await criarTenant(b.admin, 'portal-regressao', ['core']);
    await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email: 'reg@exemplo.invalid', nome: 'Pessoa Fictícia', filialIds: [] });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'portal-regressao', email: 'reg@exemplo.invalid', senha: SENHA_DE_TESTE } });
    expect(login.statusCode).toBe(200);
    const eu = await app.inject({ method: 'GET', url: '/v1/auth/eu', headers: { authorization: `Bearer ${login.json<{ token_acesso: string }>().token_acesso}` } });
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toMatchObject({ empresa: { slug: 'portal-regressao' } });
  });

  it('logs sem e-mail, senha, token nem nome de empresa (regra 8)', () => {
    const tudo = logs.join('\n');
    expect(tudo).toContain('superadmin_id');
    for (const proibido of [EMAIL_SA, EMAIL_TROCA, SENHA_SA, SENHA_NOVA, 'primeiro@exemplo.invalid', 'Empresa Portal API', COOKIE_CONFIG]) expect(tudo).not.toContain(proibido);
  });
});
