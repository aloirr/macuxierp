/**
 * T-0050 (E6.1): isolamento entre as credenciais do tenant e do portal `/config` (ADR 0012 §2, §4 e §8), na API real
 * (`criarApp` com o plugin de plataforma do #315) sobre o PostgreSQL efêmero migrado até a 0033. O plugin de plataforma
 * só fala com o banco pelas funções da lista fechada, sem adaptador em memória: por isso o teste é `.db.test.ts`.
 * - o cookie `macuxierp_config` não vale em nenhuma rota de `/v1/<modulo>` nem em `/v1/auth/*`;
 * - o JWT do tenant não vale em `/v1/plataforma/*` (401);
 * - escrita em `/v1/plataforma/*` sem `x-macuxierp-config: 1` é 403 ORIGEM_RECUSADA e não muda nada (CSRF);
 * - com `deve_trocar_senha`, só `auth/eu`, `auth/senha` e `auth/sair` respondem; o resto é 403 TROCAR_SENHA;
 * - sem impersonação: nenhuma resposta do portal traz token, sessão ou cookie de tenant.
 * As rotas do portal vêm do plugin real (`pluginsPlataforma`): rota nova entra sozinha na matriz.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMINHOS_CARGAS_PLATAFORMA, CAMINHOS_INTEGRACAO_FDV_PLATAFORMA, COOKIE_CONFIG, PREFIXO_PLATAFORMA, type PluginModulo } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { COOKIE_REFRESH } from '../../../apps/api/src/app';
import { pluginsPlataforma } from '../../../apps/api/src/modulos';
import { atalhosPortal, inserirSuperadmin, SENHA_SA, type AppPortal, type MetodoPortal, type RespostaPortal } from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-e6-isolamento@exemplo.invalid';
const EMAIL_TROCA = 'sa-e6-troca@exemplo.invalid';
const ESCRITAS = new Set<MetodoPortal>(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_PORTAL = [
  { metodo: 'GET', url: `${PREFIXO_PLATAFORMA}/auth/eu` },
  { metodo: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/senha` },
  { metodo: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/sair` },
] as const;
/** JWT (cabeçalho base64url de `{"alg"...`) ou campo de credencial de tenant numa resposta do portal. */
const PARECE_JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./;
const CAMPOS_CREDENCIAL_TENANT = ['token_acesso', 'refresh', 'refresh_token', 'access_token', 'token'];

interface Rota {
  metodo: MetodoPortal;
  url: string;
}

/** `:param` vira um UUID novo (a rota responde antes de ler o recurso). */
const urlDe = (prefixo: string, caminho: string) => `${prefixo}${caminho.replace(/:[A-Za-z_]+/g, () => randomUUID())}`;

describe.skipIf(!PG_DISPONIVEL)('portal /config: isolamento das credenciais de tenant e de plataforma (T-0050 E6.1, ADR 0012 §2 e §4)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let modulos: readonly PluginModulo[];
  let rotasPortal: Rota[] = [];
  let rotasModulos: Rota[] = [];
  let jwt = '';
  let refreshTenant = '';
  let p: ReturnType<typeof atalhosPortal>;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_SA);
    await inserirSuperadmin(b, EMAIL_TROCA, { deveTrocar: true });
    ({ app, modulos } = await appPgDeTeste({ b, modulos: 'producao' }));
    p = atalhosPortal(app);
    rotasPortal = pluginsPlataforma(modulos).flatMap((pl) => pl.rotas.map((r) => ({ metodo: r.metodo as MetodoPortal, url: urlDe(PREFIXO_PLATAFORMA, r.caminho) })));
    rotasModulos = modulos.flatMap((m) => m.rotas.map((r) => ({ metodo: r.metodo as MetodoPortal, url: urlDe(`/v1/${m.manifesto.id}`, r.caminho) })));
    // Tenant com todos os módulos e o administrador: o JWT e o refresh são credenciais de tenant reais.
    const t = await criarTenant(b.admin, 'e6-isolamento', modulos.map((m) => m.manifesto.id));
    await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email: 'adm-e6@exemplo.invalid', nome: 'Pessoa Fictícia', filialIds: [] });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'e6-isolamento', email: 'adm-e6@exemplo.invalid', senha: SENHA_DE_TESTE } });
    expect(login.statusCode).toBe(200);
    jwt = login.json<{ token_acesso: string }>().token_acesso;
    refreshTenant = login.cookies.find((c) => c.name === COOKIE_REFRESH)!.value;
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('a matriz cobre o plugin real: há rotas de plataforma (leitura e escrita) e rotas de módulo montadas', () => {
    expect(rotasPortal.some((r) => r.metodo === 'GET')).toBe(true);
    expect(rotasPortal.some((r) => ESCRITAS.has(r.metodo))).toBe(true);
    expect(new Set(modulos.map((m) => m.manifesto.id)).size).toBeGreaterThan(1);
    expect(rotasModulos.length).toBeGreaterThan(rotasPortal.length);
  });

  it('T-0056 (ADR 0013 §2): as 6 rotas da integração FDV do portal entram sozinhas na matriz, pelo plugin real', () => {
    const declaradas = pluginsPlataforma(modulos).flatMap((pl) => pl.rotas.map((r) => `${r.metodo} ${r.caminho}`));
    const C = CAMINHOS_INTEGRACAO_FDV_PLATAFORMA;
    const esperadas = [`GET ${C.ler}`, `PUT ${C.credencial}`, `POST ${C.testar}`, `PUT ${C.configuracao}`, `POST ${C.cargaCompleta}`, `POST ${C.retomar}`];
    expect(declaradas.filter((d) => d.includes('/integracao-fdv')).sort()).toEqual([...esperadas].sort());
  });

  it('T-0058/T-0060 (ADR 0013, adendo de 23/11/2026): as rotas da carga de cadastros do portal (validar e gravar) entram sozinhas na matriz, pelo plugin real', () => {
    const declaradas = pluginsPlataforma(modulos).flatMap((pl) => pl.rotas.map((r) => `${r.metodo} ${r.caminho}`));
    const C = CAMINHOS_CARGAS_PLATAFORMA;
    expect(declaradas.filter((d) => d.includes('/cadastros/cargas')).sort()).toEqual([`POST ${C.validar}`, `POST ${C.gravar}`].sort());
    const naMatriz = rotasPortal.map((r) => `${r.metodo} ${r.url}`);
    for (const sufixo of ['/validar', '/gravar']) expect(naMatriz.some((u) => u.startsWith('POST /v1/plataforma/empresas/') && u.endsWith(sufixo))).toBe(true);
  });

  it('ADR 0012 §2: o cookie macuxierp_config (sessão válida) é 401 em toda rota de /v1/<modulo>', async () => {
    const token = await p.sessao(EMAIL_SA);
    expect((await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token })).statusCode).toBe(200);
    const fora: string[] = [];
    for (const r of rotasModulos) {
      const res = await p.pedir(r.metodo, r.url, { token, ...(ESCRITAS.has(r.metodo) ? { corpo: {} } : {}) });
      if (res.statusCode !== 401) fora.push(`${r.metodo} ${r.url} → ${res.statusCode}`);
    }
    expect(fora).toEqual([]);
  });

  it('ADR 0012 §2: o cookie macuxierp_config não vale em /v1/auth/*; o sair do tenant não derruba a sessão do portal', async () => {
    const token = await p.sessao(EMAIL_SA);
    const cookies = { [COOKIE_CONFIG]: token };
    expect((await app.inject({ method: 'GET', url: '/v1/auth/eu', cookies })).statusCode).toBe(401);
    const refresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.body).not.toContain('token_acesso');
    // o mesmo valor no cookie de refresh do tenant também não vale (as sessões são de tabelas e formatos diferentes)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: token } })).statusCode).toBe(401);
    const sair = await app.inject({ method: 'POST', url: '/v1/auth/sair', cookies });
    expect(sair.statusCode).toBe(204);
    expect(sair.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
    expect((await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token })).statusCode).toBe(200);
  });

  it('ADR 0012 §2: o JWT do tenant (e o refresh dele) é 401 em toda rota de /v1/plataforma/*', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/auth/eu', headers: { authorization: `Bearer ${jwt}` } })).statusCode).toBe(200);
    const fora: string[] = [];
    for (const r of [...rotasPortal, ...AUTH_PORTAL.filter((a) => !a.url.endsWith('/sair'))]) {
      const res = await p.pedir(r.metodo, r.url, {
        cabecalhos: { authorization: `Bearer ${jwt}` },
        cookies: { [COOKIE_REFRESH]: refreshTenant },
        chave: randomUUID(),
        ...(ESCRITAS.has(r.metodo) ? { corpo: {} } : {}),
      });
      if (res.statusCode !== 401) fora.push(`${r.metodo} ${r.url} → ${res.statusCode}`);
    }
    expect(fora).toEqual([]);
    // o sair do portal sem sessão é 204 e não mexe na sessão do tenant
    const sair = await p.pedir('POST', `${PREFIXO_PLATAFORMA}/auth/sair`, { cabecalhos: { authorization: `Bearer ${jwt}` }, cookies: { [COOKIE_REFRESH]: refreshTenant } });
    expect(sair.statusCode).toBe(204);
    expect(sair.cookies.map((c) => c.name)).not.toContain(COOKIE_REFRESH);
  });

  it('ADR 0012 §2 (CSRF): escrita sem x-macuxierp-config: 1 é 403 ORIGEM_RECUSADA em toda rota e nada muda no banco', async () => {
    const token = await p.sessao(EMAIL_SA);
    const antes = await b.admin.query<{ t: number; a: number }>('SELECT (SELECT count(*) FROM plataforma.tenant)::int t, (SELECT count(*) FROM plataforma.auditoria)::int a');
    const escritas: Rota[] = [...rotasPortal.filter((r) => ESCRITAS.has(r.metodo)), { metodo: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/senha` }, { metodo: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/sair` }];
    const fora: string[] = [];
    for (const r of escritas) {
      for (const csrf of [false, '0', 'true', '11'] as const) {
        const res = await p.pedir(r.metodo, r.url, { token, csrf, chave: randomUUID(), corpo: { slug: 'e6-csrf', nome: 'Empresa CSRF', senha_atual: SENHA_SA, senha_nova: 'outra-senha-e6-1234' } });
        if (res.statusCode !== 403 || res.json<{ codigo: string }>().codigo !== 'ORIGEM_RECUSADA') fora.push(`${r.metodo} ${r.url} csrf=${String(csrf)} → ${res.statusCode}`);
      }
    }
    expect(fora).toEqual([]);
    // o login também é escrita
    const login = await p.entrar(EMAIL_SA, SENHA_SA, { cabecalhos: {} });
    expect(login.statusCode).toBe(403);
    expect(login.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
    const depois = await b.admin.query<{ t: number; a: number }>('SELECT (SELECT count(*) FROM plataforma.tenant)::int t, (SELECT count(*) FROM plataforma.auditoria)::int a');
    expect(depois.rows[0]).toEqual(antes.rows[0]);
    // o sair sem CSRF não revogou a sessão, e a senha não mudou
    expect((await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token })).statusCode).toBe(200);
    expect((await p.entrar(EMAIL_SA, SENHA_SA)).statusCode).toBe(200);
  });

  it('ADR 0012 §2 (troca pendente): só auth/eu, auth/senha e auth/sair respondem; toda rota do plugin é 403 TROCAR_SENHA', async () => {
    const token = await p.sessao(EMAIL_TROCA);
    const eu = await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token });
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toMatchObject({ deve_trocar_senha: true });
    const fora: string[] = [];
    for (const r of rotasPortal) {
      const res = await p.pedir(r.metodo, r.url, { token, chave: randomUUID(), ...(ESCRITAS.has(r.metodo) ? { corpo: { slug: 'e6-troca', nome: 'Empresa Troca' } } : {}) });
      if (res.statusCode !== 403 || res.json<{ codigo: string }>().codigo !== 'TROCAR_SENHA') fora.push(`${r.metodo} ${r.url} → ${res.statusCode}`);
    }
    expect(fora).toEqual([]);
    expect((await b.admin.query("SELECT 1 FROM plataforma.tenant WHERE slug = 'e6-troca'")).rowCount).toBe(0);
    // auth/senha responde (400 no campo com a senha atual errada; 204 com a certa) e libera as rotas
    expect((await p.pedir('POST', `${PREFIXO_PLATAFORMA}/auth/senha`, { token, corpo: { senha_atual: 'nao-e-esta-senha', senha_nova: 'senha-nova-e6-troca-123' } })).statusCode).toBe(400);
    const outra = await p.sessao(EMAIL_TROCA);
    expect((await p.pedir('POST', `${PREFIXO_PLATAFORMA}/auth/sair`, { token: outra })).statusCode).toBe(204);
    expect((await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token: outra })).statusCode).toBe(401);
    expect((await p.pedir('POST', `${PREFIXO_PLATAFORMA}/auth/senha`, { token, corpo: { senha_atual: SENHA_SA, senha_nova: 'senha-nova-e6-troca-123' } })).statusCode).toBe(204);
    expect((await p.pedir('GET', `${PREFIXO_PLATAFORMA}/empresas`, { token })).statusCode).toBe(200);
  });

  it('ADR 0012 §2 e §8 (sem impersonação): nenhuma resposta do portal traz token, sessão ou cookie de tenant', async () => {
    const sessoesTenantAntes = (await b.admin.query<{ n: number }>('SELECT count(*)::int n FROM plataforma.sessao')).rows[0]!.n;
    const respostas: [string, RespostaPortal][] = [];
    const guardar = (nome: string, r: RespostaPortal) => {
      respostas.push([nome, r]);
      return r;
    };
    const login = guardar('entrar', await p.entrar(EMAIL_SA, SENHA_SA));
    const token = p.cookieDe(login);
    guardar('eu', await p.pedir('GET', `${PREFIXO_PLATAFORMA}/auth/eu`, { token }));
    guardar('listar', await p.pedir('GET', `${PREFIXO_PLATAFORMA}/empresas`, { token }));
    const criada = guardar('criar', await p.pedir('POST', `${PREFIXO_PLATAFORMA}/empresas`, { token, chave: randomUUID(), corpo: { slug: 'e6-sem-imp', nome: 'Empresa Sem Impersonação' } }));
    expect(criada.statusCode).toBe(201);
    const id = criada.json<{ id: string }>().id;
    const base = `${PREFIXO_PLATAFORMA}/empresas/${id}`;
    guardar('ler', await p.pedir('GET', base, { token }));
    guardar('modulos', await p.pedir('PUT', `${base}/modulos`, { token, corpo: { modulos: [{ modulo: 'cadastros', ativo: true }] } }));
    const adm = guardar('primeiro-admin', await p.pedir('POST', `${base}/primeiro-admin`, { token, chave: randomUUID(), corpo: { email: 'adm-imp@exemplo.invalid', nome: 'Pessoa Fictícia' } }));
    expect(adm.statusCode).toBe(201);
    guardar('redefinir', await p.pedir('POST', `${base}/primeiro-admin/senha`, { token, chave: randomUUID() }));
    guardar('situacao', await p.pedir('PUT', `${base}/situacao`, { token, corpo: { situacao: 'suspenso', motivo: 'teste E6 sem impersonação' } }));
    guardar('sair', await p.pedir('POST', `${PREFIXO_PLATAFORMA}/auth/sair`, { token }));

    for (const [nome, r] of respostas) {
      expect(r.statusCode, nome).toBeLessThan(300);
      expect(r.cookies.map((c) => c.name).filter((n) => n !== COOKIE_CONFIG), nome).toEqual([]);
      expect(r.headers.authorization, nome).toBeUndefined();
      expect(r.body, nome).not.toMatch(PARECE_JWT);
      const corpo: unknown = r.body ? JSON.parse(r.body) : null;
      const chaves = JSON.stringify(corpo, (k, v: unknown) => (CAMPOS_CREDENCIAL_TENANT.includes(k) ? '<<CREDENCIAL>>' : v));
      expect(chaves ?? '', nome).not.toContain('<<CREDENCIAL>>');
      expect(r.body, nome).not.toContain(token);
    }
    // nem o token do portal vai no corpo do login: só no cookie
    expect(Object.keys(login.json())).toEqual(['expira_em']);
    // nenhuma sessão de tenant foi aberta pelo portal (nem para o administrador criado)
    expect((await b.admin.query<{ n: number }>('SELECT count(*)::int n FROM plataforma.sessao')).rows[0]!.n).toBe(sessoesTenantAntes);
  });
});
