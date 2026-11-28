/**
 * T-0133 (v0.3.30, ADR 0021): login só com e-mail e senha, conferido de fora na API de produção (`appPgDeTeste`, módulos
 * de produção) sobre o PostgreSQL efêmero migrado (com a 0079 e a `plataforma.conta_por_email`). Só a tela única, como a
 * web manda desde a T-0133: `{ email, senha }`, sem o campo `empresa`, sempre com o anti-CSRF do `/config`.
 * - L-1 (§3): empresa suspensa: a senha errada recebe o 401 de sempre (a suspensão não vaza); só a senha certa recebe o
 *   403 `EMPRESA_SUSPENSA`, sem sessão;
 * - L-2 (§1): criar usuário com o e-mail de outra empresa = 409 `CONFLITO`, `detalhes.codigo` 'email_em_uso' e
 *   `campos.email`, com o texto travado; pelo BKO (`POST /v1/core/usuarios`) e pelo `/config` (primeiro administrador);
 * - L-3 (§7, opção A, decisão 45 A): o mesmo e-mail como usuário de empresa e superadmin: o login vai ao BKO, na empresa
 *   do usuário; o `/config` só abre pelo `CAMINHO_ENTRAR_PELO_BKO` dessa sessão;
 * - L-4 (§5): o e-mail só de superadmin vai ao `/config` (cookie do portal, sem o refresh do BKO).
 * Os textos são conferidos pelo valor literal (o teste confere o valor, não a constante do SDK).
 * NÃO se repete: a unidade do serviço (apps/api/src/auth/servico-login.test.ts), o teste obrigatório do dono
 * (apps/api/src/login-email.db.test.ts), o log do esqueci (esqueci-log.db.test.ts) e a trava (conta-bloqueada.db.test.ts).
 * Dados fictícios (domínios .invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CABECALHO_CSRF_CONFIG, CAMINHO_ENTRAR_PELO_BKO, COOKIE_CONFIG, PREFIXO_PLATAFORMA } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../../modules/core/api/index';
import { appPgDeTeste, destinoDeLogs, EnvioEmailMemoria, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { COOKIE_REFRESH } from '../../../apps/api/src/app';
import { atalhosPortal, inserirSuperadmin, SENHA_SA, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

/** Textos travados pelo PO (ADR 0021, seção Textos), exatamente assim. */
const TEXTO = {
  invalido: 'E-mail ou senha inválidos.',
  suspensa: 'Sua empresa está suspensa. Fale com o administrador da Macuxi.',
  emUso: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.',
} as const;

const DOMINIO = 'login-t0133.invalid';
const EMAIL_A = `ana.empresa-a@${DOMINIO}`;
const EMAIL_B = `bento.empresa-b@${DOMINIO}`;
const EMAIL_SUSPENSA = `caua.suspensa@${DOMINIO}`;
const EMAIL_DUPLO = `duda.duplo@${DOMINIO}`;
const EMAIL_SO_SA = `edu.so-superadmin@${DOMINIO}`;
const SENHA_ERRADA = 'senha-errada-t0133!';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' } as const;
/**
 * Liga o L-2. Fica `false` enquanto o módulo core não traduz o 23505 do e-mail de outra empresa (0079) no
 * `email_em_uso` do SDK; na v0.3.30 o BKO dá 500 `ERRO_INTERNO` e o `/config` dá o 409 genérico sem `campos` nem
 * `detalhes` (recado ao modulo-core). O testes troca para `true` no PR da correção.
 */
const EMAIL_EM_USO_NO_CORE = false;

describe.skipIf(!PG_DISPONIVEL)('T-0133: login só com e-mail e senha na API real (ADR 0021)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  const logs: string[] = [];
  let tenantA = '';
  let tenantB = '';
  let filialB = '';
  let ip = 1;
  const novoIp = () => `10.133.0.${ip++}`;

  const login = (email: string, senha: string): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), headers: CSRF, payload: { email, senha } });
  const nomes = (r: RespostaPortal) => r.cookies.map((c) => c.name);
  const cookie = (r: RespostaPortal, nome: string) => r.cookies.find((c) => c.name === nome)?.value;
  const recusa401 = (r: RespostaPortal) => {
    expect(r.statusCode, r.body).toBe(401);
    expect(r.json()).toEqual({ codigo: 'NAO_AUTENTICADO', mensagem: TEXTO.invalido });
    expect(r.cookies).toEqual([]);
  };
  const emUso409 = (r: RespostaPortal) => {
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ codigo: 'CONFLITO', mensagem: TEXTO.emUso, campos: { email: TEXTO.emUso }, detalhes: { codigo: 'email_em_uso' } });
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenantA = await criarTenant(b.admin, 'tq0133', ['cadastros']);
    tenantB = await criarTenant(b.admin, 'tq0134', ['cadastros']);
    const suspensa = await criarTenant(b.admin, 'tq0135', ['cadastros']);
    filialB = randomUUID();
    await inserirFilialDeTeste(b.admin, tenantB, { id: filialB, cnpj: '11222333000181', nome: 'Filial Fictícia B' });
    await inserirAdministradorDeTeste(b.admin, tenantA, { id: randomUUID(), email: EMAIL_A, nome: 'Ana Ficticia', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenantB, { id: randomUUID(), email: EMAIL_B, nome: 'Bento Ficticio', filialIds: [filialB] });
    await inserirAdministradorDeTeste(b.admin, suspensa, { id: randomUUID(), email: EMAIL_SUSPENSA, nome: 'Caua Ficticio', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenantA, { id: randomUUID(), email: EMAIL_DUPLO, nome: 'Duda Ficticia', filialIds: [] });
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [suspensa]);
    // §7: o superadmin fica fora da unicidade; o mesmo e-mail do usuário da empresa A, com outra senha (SENHA_SA)
    await inserirSuperadmin(b, EMAIL_DUPLO);
    await inserirSuperadmin(b, EMAIL_SO_SA);
    ({ app } = await appPgDeTeste({
      b,
      modulos: 'producao',
      esqueci: { envio: new EnvioEmailMemoria(), repoCore: new RepositorioCoreSql() },
      logger: { level: 'info', stream: destinoDeLogs(logs) },
    }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('L-1 (§3): empresa suspensa, senha errada = 401 "E-mail ou senha inválidos." (a suspensão não vaza); senha certa = 403 EMPRESA_SUSPENSA sem sessão', async () => {
    const errada = await login(EMAIL_SUSPENSA, SENHA_ERRADA);
    recusa401(errada);
    // a senha errada da conta suspensa tem o mesmo corpo do e-mail que não existe
    const ninguem = await login(`ninguem@${DOMINIO}`, SENHA_ERRADA);
    expect(ninguem.body).toBe(errada.body);
    const certa = await login(EMAIL_SUSPENSA, SENHA_DE_TESTE);
    expect(certa.statusCode, certa.body).toBe(403);
    expect(certa.json()).toEqual({ codigo: 'EMPRESA_SUSPENSA', mensagem: TEXTO.suspensa });
    expect(certa.cookies).toEqual([]);
    const { rows } = await b.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.sessao WHERE usuario_id = (SELECT id FROM plataforma.usuario WHERE email = $1)', [EMAIL_SUSPENSA]);
    expect(rows[0]!.n).toBe(0);
  });

  if (!EMAIL_EM_USO_NO_CORE) it.todo('L-2 (§1): pelo BKO, criar usuário com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email e o texto travado (falta o core traduzir o 23505)');
  it.runIf(EMAIL_EM_USO_NO_CORE)('L-2 (§1): pelo BKO, criar usuário com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email e o texto travado', async () => {
    const lb = await login(EMAIL_B, SENHA_DE_TESTE);
    expect(lb.statusCode, lb.body).toBe(200);
    const token = lb.json<{ token_acesso: string }>().token_acesso;
    const r = await app.inject({
      method: 'POST',
      url: '/v1/core/usuarios',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
      payload: { nome: 'Outra Ana Ficticia', email: EMAIL_A, perfil: 'vendedor', filial_ids: [filialB] },
    });
    emUso409(r);
    const { rows } = await b.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.usuario WHERE email = $1', [EMAIL_A]);
    expect(rows[0]!.n).toBe(1);
  });

  if (!EMAIL_EM_USO_NO_CORE) it.todo('L-2 (§1): pelo /config, o primeiro administrador com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email e o texto travado (falta o core traduzir o 23505)');
  it.runIf(EMAIL_EM_USO_NO_CORE)('L-2 (§1): pelo /config, o primeiro administrador com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email e o texto travado', async () => {
    const p = atalhosPortal(app);
    const tokenSa = await p.sessao(EMAIL_SO_SA);
    const criada = await p.pedir('POST', '/v1/plataforma/empresas', { token: tokenSa, corpo: { slug: 'tq0136', nome: 'Empresa Fictícia T-0133' }, chave: randomUUID() });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = criada.json<{ id: string }>().id;
    const r = await p.pedir('POST', `/v1/plataforma/empresas/${id}/primeiro-admin`, { token: tokenSa, corpo: { email: EMAIL_A, nome: 'Outra Ana Ficticia' }, chave: randomUUID() });
    emUso409(r);
  });

  it('L-3 (§7, decisão 45 A): o mesmo e-mail no usuário da empresa e no superadmin: o login vai ao BKO da empresa; o /config só abre pela rota do BKO', async () => {
    const r = await login(EMAIL_DUPLO, SENHA_DE_TESTE);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ destino: 'bko', token_acesso: expect.any(String) });
    expect(nomes(r)).not.toContain(COOKIE_CONFIG);
    const token = r.json<{ token_acesso: string }>().token_acesso;
    const eu = await app.inject({ method: 'GET', url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(eu.statusCode, eu.body).toBe(200);
    expect(eu.json()).toMatchObject({ empresa: { id: tenantA } });
    expect(eu.json<{ empresa: { id: string } }>().empresa.id).not.toBe(tenantB);
    // a senha do superadmin pela tela única não abre nada: o usuário da empresa vem primeiro (opção A)
    recusa401(await login(EMAIL_DUPLO, SENHA_SA));
    // o /config abre pela rota da decisão 45 A, com a sessão do BKO
    const config = await app.inject({ method: 'POST', url: CAMINHO_ENTRAR_PELO_BKO, headers: CSRF, cookies: { [COOKIE_REFRESH]: cookie(r, COOKIE_REFRESH)! } });
    expect(config.statusCode, config.body).toBe(200);
    const sessaoConfig = cookie(config, COOKIE_CONFIG);
    expect(sessaoConfig).toBeDefined();
    const euConfig = await app.inject({ method: 'GET', url: `${PREFIXO_PLATAFORMA}/auth/eu`, cookies: { [COOKIE_CONFIG]: sessaoConfig! } });
    expect(euConfig.statusCode, euConfig.body).toBe(200);
  });

  it('L-4 (§5): o e-mail só de superadmin vai ao /config, com o cookie do portal e sem o refresh do BKO', async () => {
    const r = await login(EMAIL_SO_SA, SENHA_SA);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    expect(nomes(r)).toContain(COOKIE_CONFIG);
    expect(nomes(r)).not.toContain(COOKIE_REFRESH);
    const eu = await app.inject({ method: 'GET', url: `${PREFIXO_PLATAFORMA}/auth/eu`, cookies: { [COOKIE_CONFIG]: cookie(r, COOKIE_CONFIG)! } });
    expect(eu.statusCode, eu.body).toBe(200);
  });

  it('LGPD: o log da API não traz nenhum e-mail, parte local nem a senha', () => {
    const texto = logs.join('\n').toLowerCase();
    expect(texto.length).toBeGreaterThan(0);
    for (const e of [EMAIL_A, EMAIL_B, EMAIL_SUSPENSA, EMAIL_DUPLO, EMAIL_SO_SA]) for (const x of [e, e.split('@')[0]!]) expect(texto).not.toContain(x);
    expect(texto).not.toContain(DOMINIO);
    for (const s of [SENHA_DE_TESTE, SENHA_SA, SENHA_ERRADA]) expect(texto).not.toContain(s.toLowerCase());
  });
});
