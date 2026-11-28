/**
 * T-0133 (v0.3.30, ADR 0021): login só com e-mail e senha, conferido de fora na API de produção (`appPgDeTeste`, módulos
 * de produção) sobre o PostgreSQL efêmero migrado (com a 0079 e a `plataforma.conta_por_email`). Só a tela única, como a
 * web manda desde a T-0133: `{ email, senha }`, sem o campo `empresa`, sempre com o anti-CSRF do `/config`.
 * - L-1 (§3): a senha errada da conta de empresa suspensa tem o mesmo corpo do e-mail inexistente (a suspensão não vaza);
 * - L-2 (§1, RN-CORE-18): criar usuário com o e-mail de outra empresa = 409 `CONFLITO`, `detalhes.codigo` 'email_em_uso'
 *   e `campos.email`, com o texto do SDK; pelo BKO (`POST /v1/core/usuarios`) e pelo `/config` (primeiro administrador);
 * - L-3 (§7, opção A): o mesmo e-mail como usuário de empresa e superadmin abre a sessão na empresa do usuário (`/auth/eu`);
 * - LGPD: o log da API não traz e-mail, parte local nem senha.
 * NÃO se repete o que o dono já cobre em apps/api/src/login-email.db.test.ts (destino bko e config, o 403
 * `EMPRESA_SUSPENSA` da senha certa, a senha do superadmin no e-mail duplo, o `/config` pelo `CAMINHO_ENTRAR_PELO_BKO` e a
 * empresa encerrada), nem a unidade do serviço (apps/api/src/auth/servico-login.test.ts), o log do esqueci
 * (esqueci-log.db.test.ts) e a trava (conta-bloqueada.db.test.ts).
 * Dados fictícios (domínios .invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENSAGEM_EMAIL_EM_USO } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../../modules/core/api/index';
import { appPgDeTeste, destinoDeLogs, EnvioEmailMemoria, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { atalhosPortal, CSRF, inserirSuperadmin, novoIp, SENHA_SA, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';
import { esperarRecusaUnica } from '../../apoio/portal-pg-expect';

const DOMINIO = 'login-t0133.invalid';
const EMAIL_A = `ana.empresa-a@${DOMINIO}`;
const EMAIL_B = `bento.empresa-b@${DOMINIO}`;
const EMAIL_SUSPENSA = `caua.suspensa@${DOMINIO}`;
const EMAIL_DUPLO = `duda.duplo@${DOMINIO}`;
const EMAIL_SO_SA = `edu.so-superadmin@${DOMINIO}`;
const SENHA_ERRADA = 'senha-errada-t0133!';

describe.skipIf(!PG_DISPONIVEL)('T-0133: login só com e-mail e senha na API real (ADR 0021)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  const logs: string[] = [];
  let tenantA = '';
  let filialB = '';

  const login = (email: string, senha: string): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), headers: CSRF, payload: { email, senha } });
  const emUso409 = (r: RespostaPortal) => {
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ codigo: 'CONFLITO', mensagem: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO }, detalhes: { codigo: 'email_em_uso' } });
  };
  const contarUsuarios = async (email: string) => (await b.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.usuario WHERE email = $1', [email])).rows[0]!.n;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenantA = await criarTenant(b.admin, 'tq0133', ['cadastros']);
    const tenantB = await criarTenant(b.admin, 'tq0134', ['cadastros']);
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

  it('L-1 (§3): a senha errada da empresa suspensa tem o mesmo corpo do e-mail inexistente (a suspensão não vaza)', async () => {
    const errada = await login(EMAIL_SUSPENSA, SENHA_ERRADA);
    esperarRecusaUnica(errada);
    const ninguem = await login(`ninguem@${DOMINIO}`, SENHA_ERRADA);
    expect(ninguem.body).toBe(errada.body);
  });

  it('L-2 (§1): pelo BKO, criar usuário com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email', async () => {
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
    expect(await contarUsuarios(EMAIL_A)).toBe(1);
  });

  it('L-2 (§1): pelo /config, o primeiro administrador com o e-mail de outra empresa = 409 CONFLITO email_em_uso com campos.email', async () => {
    const p = atalhosPortal(app);
    const tokenSa = await p.sessao(EMAIL_SO_SA);
    const criada = await p.pedir('POST', '/v1/plataforma/empresas', { token: tokenSa, corpo: { slug: 'tq0136', nome: 'Empresa Fictícia T-0133' }, chave: randomUUID() });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = criada.json<{ id: string }>().id;
    const r = await p.pedir('POST', `/v1/plataforma/empresas/${id}/primeiro-admin`, { token: tokenSa, corpo: { email: EMAIL_A, nome: 'Outra Ana Ficticia' }, chave: randomUUID() });
    emUso409(r);
    expect(await contarUsuarios(EMAIL_A)).toBe(1);
  });

  it('L-3 (§7, opção A): o mesmo e-mail no usuário da empresa e no superadmin abre a sessão na empresa do usuário', async () => {
    const r = await login(EMAIL_DUPLO, SENHA_DE_TESTE);
    expect(r.statusCode, r.body).toBe(200);
    const eu = await app.inject({ method: 'GET', url: '/v1/auth/eu', headers: { authorization: `Bearer ${r.json<{ token_acesso: string }>().token_acesso}` } });
    expect(eu.statusCode, eu.body).toBe(200);
    expect(eu.json()).toMatchObject({ empresa: { id: tenantA } });
  });

  it('LGPD: o log da API não traz nenhum e-mail, parte local nem a senha', () => {
    const texto = logs.join('\n').toLowerCase();
    expect(texto.length).toBeGreaterThan(0);
    for (const e of [EMAIL_A, EMAIL_B, EMAIL_SUSPENSA, EMAIL_DUPLO, EMAIL_SO_SA]) for (const x of [e, e.split('@')[0]!]) expect(texto).not.toContain(x);
    expect(texto).not.toContain(DOMINIO);
    for (const s of [SENHA_DE_TESTE, SENHA_SA, SENHA_ERRADA]) expect(texto).not.toContain(s.toLowerCase());
  });
});
