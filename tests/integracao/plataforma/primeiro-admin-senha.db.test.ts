/**
 * T-0050 (E6.5): a senha provisória do 1º administrador no portal `/config` (ADR 0012 §2 e §5), de ponta a ponta na API
 * real sobre o PostgreSQL efêmero: o portal cria ou redefine, e o administrador entra (ou não) pelo login do TENANT.
 * - POST /v1/plataforma/empresas/:id/primeiro-admin e .../primeiro-admin/senha: a senha aparece só na resposta, com
 *   CABECALHOS_SENHA_PROVISORIA (no-store e no-cache); nunca no banco em claro (idempotência sem corpo, auditoria sem
 *   senha nem hash) nem no log pino; o reenvio com a mesma Idempotency-Key é 409 sem senha e não gera outra;
 * - redefinir zera falhas_login e bloqueado_ate do administrador e revoga as sessões (refresh) dele; a senha antiga
 *   deixa de valer e a nova entra.
 * O apps/api/src/plataforma.db.test.ts já confere o 201/409 do 1º admin pela API; aqui entram a redefinição, o login
 * do tenant com a senha entregue e os vazamentos (banco, auditoria e log). Dados fictícios (exemplo.invalid).
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CABECALHOS_SENHA_PROVISORIA, COOKIE_CONFIG } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, destinoDeLogs } from '../../../apps/api/src/apoio-teste';
import { COOKIE_REFRESH } from '../../../apps/api/src/app';
import { conferirSenha } from '../../../apps/api/src/auth/senha';
import { atalhosPortal, inserirSuperadmin, novoIp, SENHA_SA, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-e6-primeiro-admin@exemplo.invalid';
const SLUG = 'e6-primeiro-admin';
const NOME_EMPRESA = 'Empresa Fictícia Primeiro Admin E6';
const EMAIL_ADM = 'adm-e6-primeiro@exemplo.invalid';
const NOME_ADM = 'Pessoa Administradora Fictícia';

describe.skipIf(!PG_DISPONIVEL)('portal /config: senha provisória do 1º administrador (T-0050 E6.5, ADR 0012 §2 e §5)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  let token = '';
  let empresa = '';
  let usuario = '';
  const senhas: string[] = [];

  const entrarTenant = (senha: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), payload: { empresa: SLUG, email: EMAIL_ADM, senha } });
  const refreshDe = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === COOKIE_REFRESH)!.value;
  const adm = async () =>
    (
      await b.admin.query<{ senha_hash: string; falhas_login: number; bloqueado_ate: Date | null }>(
        'SELECT senha_hash, falhas_login, bloqueado_ate FROM plataforma.usuario WHERE id = $1',
        [usuario],
      )
    ).rows[0]!;
  const sessoesAbertas = async () =>
    Number((await b.admin.query('SELECT count(*) AS n FROM plataforma.sessao WHERE usuario_id = $1 AND revogada_em IS NULL', [usuario])).rows[0].n);
  /** Tudo o que o banco guardou da plataforma em texto (auditoria e idempotência), para procurar senha e hash. */
  const textoDoBanco = async () => {
    const aud = await b.admin.query('SELECT acao, antes, depois FROM plataforma.auditoria WHERE tenant_id IN ($1, plataforma.tenant_referencia())', [empresa]);
    const idem = await b.admin.query("SELECT rota, resposta FROM plataforma.idempotencia WHERE rota LIKE 'POST /v1/plataforma/%'");
    return JSON.stringify([aud.rows, idem.rows]);
  };
  const semCacheDaSenha = (r: RespostaPortal) => {
    for (const [k, v] of Object.entries(CABECALHOS_SENHA_PROVISORIA)) expect(r.headers[k], k).toBe(v);
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_SA);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    p = atalhosPortal(app);
    token = await p.sessao(EMAIL_SA);
    const criada = await p.pedir('POST', '/v1/plataforma/empresas', { token, corpo: { slug: SLUG, nome: NOME_EMPRESA }, chave: randomUUID() });
    expect(criada.statusCode).toBe(201);
    empresa = criada.json<{ id: string }>().id;
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('1º admin: a senha vem só na resposta (no-store), confere com o hash e entra no login do tenant; nada dela no banco', async () => {
    const chave = randomUUID();
    const r = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin`, { token, corpo: { email: EMAIL_ADM, nome: NOME_ADM }, chave });
    expect(r.statusCode).toBe(201);
    semCacheDaSenha(r);
    const corpo = r.json<{ usuario_id: string; senha_provisoria: string }>();
    expect(Object.keys(corpo).sort()).toEqual(['senha_provisoria', 'usuario_id']);
    usuario = corpo.usuario_id;
    senhas.push(corpo.senha_provisoria);
    expect(corpo.senha_provisoria.length).toBeGreaterThanOrEqual(16);

    const { senha_hash } = await adm();
    expect(senha_hash).toMatch(/^\$argon2id\$/);
    expect(await conferirSenha(corpo.senha_provisoria, senha_hash)).toBe(true);
    const banco = await textoDoBanco();
    for (const x of [corpo.senha_provisoria, senha_hash, EMAIL_ADM, NOME_ADM]) expect(banco).not.toContain(x);

    // o reenvio da mesma chave: 409, sem senha, e o hash não muda (clique duplo não gera duas senhas)
    const de_novo = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin`, { token, corpo: { email: EMAIL_ADM, nome: NOME_ADM }, chave });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.body).not.toContain('senha_provisoria');
    expect((await adm()).senha_hash).toBe(senha_hash);

    const login = await entrarTenant(corpo.senha_provisoria);
    expect(login.statusCode).toBe(200);
  });

  it('redefinir: 200 no-store com senha nova; zera falhas e trava, revoga as sessões do admin; a antiga deixa de valer', async () => {
    // duas sessões abertas (refresh) do admin e a conta travada pela RN-CORE-07
    const r1 = refreshDe(await entrarTenant(senhas[0]!));
    const r2 = refreshDe(await entrarTenant(senhas[0]!));
    expect(await sessoesAbertas()).toBeGreaterThanOrEqual(2);
    const abertas = await sessoesAbertas();
    await b.admin.query("UPDATE plataforma.usuario SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes' WHERE id = $1", [usuario]);
    expect((await entrarTenant(senhas[0]!)).statusCode).not.toBe(200);
    const hashAntes = (await adm()).senha_hash;

    const chave = randomUUID();
    const r = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin/senha`, { token, chave });
    expect(r.statusCode).toBe(200);
    semCacheDaSenha(r);
    const corpo = r.json<{ usuario_id: string; senha_provisoria: string }>();
    expect(corpo.usuario_id).toBe(usuario);
    expect(corpo.senha_provisoria).not.toBe(senhas[0]);
    senhas.push(corpo.senha_provisoria);

    const depois = await adm();
    expect(depois).toMatchObject({ falhas_login: 0, bloqueado_ate: null });
    expect(depois.senha_hash).not.toBe(hashAntes);
    expect(await conferirSenha(corpo.senha_provisoria, depois.senha_hash)).toBe(true);
    expect(await sessoesAbertas()).toBe(0);
    for (const refresh of [r1, r2]) {
      const renovar = await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: refresh } });
      expect(renovar.statusCode).toBe(401);
    }
    const aud = await b.admin.query("SELECT tenant_id, superadmin_id, depois FROM plataforma.auditoria WHERE acao = 'plataforma.admin.redefinir_senha'");
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0]).toMatchObject({ tenant_id: empresa, depois: { sessoes_revogadas: abertas } });
    expect(aud.rows[0].superadmin_id).not.toBeNull();

    // a senha antiga não entra; a nova entra (e a conta não está mais travada)
    expect((await entrarTenant(senhas[0]!)).statusCode).toBe(401);
    expect((await entrarTenant(corpo.senha_provisoria)).statusCode).toBe(200);

    // reenvio da mesma chave: 409 sem senha; o hash não muda. Sem chave: 400 e nada muda.
    const hash = (await adm()).senha_hash;
    const de_novo = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin/senha`, { token, chave });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.body).not.toContain('senha_provisoria');
    expect(de_novo.body).not.toContain(corpo.senha_provisoria);
    expect((await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin/senha`, { token })).statusCode).toBe(400);
    expect((await adm()).senha_hash).toBe(hash);

    const banco = await textoDoBanco();
    for (const x of [...senhas, hash, hashAntes]) expect(banco).not.toContain(x);
  });

  it('empresa sem administrador: redefinir não gera senha (422 RN-CORE-01, sem senha no corpo)', async () => {
    const outra = await p.pedir('POST', '/v1/plataforma/empresas', { token, corpo: { slug: 'e6-sem-admin', nome: 'Empresa Fictícia Sem Admin' }, chave: randomUUID() });
    const r = await p.pedir('POST', `/v1/plataforma/empresas/${outra.json<{ id: string }>().id}/primeiro-admin/senha`, { token, chave: randomUUID() });
    // modules/core/api/plataforma.ts: avaliarRedefinirSenhaPrimeiroAdmin → erros.regra (422), antes de gerar a senha
    expect(r.statusCode).toBe(422);
    expect(r.json<{ codigo: string }>().codigo).toBe('RN-CORE-01');
    expect(r.body).not.toContain('senha_provisoria');
  });

  it('regra 8: o log pino não traz senha provisória, e-mail, nome do admin nem nome da empresa', () => {
    const tudo = logs.join('\n');
    expect(tudo).toContain('/primeiro-admin/senha');
    expect(senhas).toHaveLength(2);
    for (const x of [...senhas, EMAIL_ADM, 'adm-e6-primeiro', NOME_ADM, NOME_EMPRESA, EMAIL_SA, SENHA_SA, COOKIE_CONFIG]) expect(tudo, `log com ${x.slice(0, 6)}…`).not.toContain(x);
    expect(tudo).not.toContain('senha_provisoria');
  });
});
