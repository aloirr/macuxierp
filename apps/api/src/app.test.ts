import { Writable } from 'node:stream';
import { definirPlugin, definirRota, erros, EuResposta, type Licenca } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, OutboxMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COOKIE_REFRESH, criarApp, type LeitorAvisosA1 } from './app';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { gerarHashSenha } from './auth/senha';
import { modulosDeTeste } from './apoio-teste';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const OUTRO_TENANT = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const ADM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const LEITOR = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const MATRIZ = '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e';
const FILIAL_2 = '4c5d6e7f-8a9b-4c0d-9e1f-3a4b5c6d7e8f';
const FILIAL_OUTRO_TENANT = '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a';
const SENHA = 'senha-de-teste-123';
const ARGON2_RAPIDO = { memoria: 64, passes: 1, paralelismo: 1 };
const INICIO = new Date('2026-11-21T15:00:00Z');

let hash: string | undefined;
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** Módulo de teste no lugar do cadastros: uma rota de escrita com Zod, evento, auditoria e 422. */
const MODULOS = modulosDeTeste();
const manifestoCadastros = MODULOS.find((m) => m.manifesto.id === 'cadastros')!.manifesto;
const pluginTeste = definirPlugin(manifestoCadastros, [
  definirRota({
    metodo: 'POST',
    caminho: '/precos',
    acao: 'cadastros.preco.editar',
    corpo: z.object({ preco_centavos: z.number().int().min(0) }),
    executar: async (c, e) => {
      if (e.corpo.preco_centavos === 13) throw erros.regra('RN-CAD-06', 'preço fora da vigência');
      const v1 = await c.publicar({ nome: 'cadastros.preco.alterado@1', agregado_id: ADM, versao: 1, payload: { preco_centavos: e.corpo.preco_centavos } });
      const v2 = await c.publicar({ nome: 'cadastros.preco.alterado@1', agregado_id: ADM, versao: 7, payload: { preco_centavos: e.corpo.preco_centavos } });
      await c.auditar({ acao: 'cadastros.preco.editar', entidade: 'preco', entidade_id: ADM, depois: e.corpo });
      await c.enfileirar({ tipo: 'cadastros.recalcular_precos', payload: {}, external_id: 'p1' });
      return { status: 201, corpo: { tenant: tenantDaTx(c.tx), versoes: [v1.versao, v2.versao] } };
    },
  }),
]);

async function montar(opcoes: { licencas?: Licenca[]; logs?: string[]; avisosA1?: LeitorAvisosA1 } = {}) {
  hash ??= await gerarHashSenha(SENHA, ARGON2_RAPIDO);
  const banco = new BancoMemoria();
  const repo = new RepositorioAuthMemoria();
  const relogio = new RelogioFixo(INICIO);
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const trabalhos = new FilaDeTrabalhosMemoria();
  repo.tenants.push(
    { id: TENANT, slug: 'thathyany', razao_social: 'Thathyany Comércio Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
    { id: OUTRO_TENANT, slug: 'outra', razao_social: 'Outra Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
  );
  repo.filiais.push(
    { id: MATRIZ, tenant_id: TENANT, nome: 'Matriz Manaus', cnpj: '11222333000181' },
    { id: FILIAL_2, tenant_id: TENANT, nome: 'Filial Parintins', cnpj: '11222333000262' },
    { id: FILIAL_OUTRO_TENANT, tenant_id: OUTRO_TENANT, nome: 'De outro tenant', cnpj: '11444777000161' },
  );
  const usuario = { tenant_id: TENANT, nome: 'Pessoa', senha_hash: hash, ativo: true, falhas_login: 0, bloqueado_ate: null };
  repo.usuarios.push(
    { ...usuario, id: ADM, email: 'adm@exemplo.com', perfil: 'administrador', filial_ids: [MATRIZ] },
    { ...usuario, id: LEITOR, email: 'leitor@exemplo.com', perfil: 'leitura', filial_ids: [FILIAL_2, MATRIZ, FILIAL_OUTRO_TENANT] },
  );
  const licencas = opcoes.licencas ?? [{ modulo: 'cadastros', ativo: true, valido_ate: null }];
  const lidasEm: (string | null)[] = [];
  const logs = opcoes.logs;
  const app = await criarApp({
    versao: '0.1.0',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: 'segredo-de-teste-com-mais-de-32-caracteres', argon2: ARGON2_RAPIDO },
    cookieSeguro: true,
    banco,
    repoAuth: repo,
    licencas: { ler: async (tx) => (lidasEm.push(tenantDaTx(tx)), licencas) },
    outbox,
    auditoria,
    trabalhos,
    relogio,
    avisosA1: opcoes.avisosA1 ?? (async () => []),
    modulos: [...MODULOS.filter((m) => m.manifesto.id !== 'cadastros'), pluginTeste],
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
  });
  apps.push(app);
  return { app, banco, repo, relogio, outbox, auditoria, trabalhos, lidasEm };
}

type App = Awaited<ReturnType<typeof montar>>['app'];

const entrar = (app: App, email = 'adm@exemplo.com', senha = SENHA, empresa = 'thathyany') =>
  app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa, email, senha } });

function refreshDe(r: { cookies: { name: string; value: string }[] }): string {
  const c = r.cookies.find((x) => x.name === COOKIE_REFRESH);
  if (!c) throw new Error('sem cookie de refresh');
  return c.value;
}

describe('GET /v1/saude', () => {
  it('responde versão e banco; banco fora é 503', async () => {
    const { app, banco } = await montar();
    expect((await app.inject('/v1/saude')).json()).toEqual({ status: 'ok', versao: '0.1.0', banco: 'ok' });
    banco.disponivel = false;
    const r = await app.inject('/v1/saude');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ banco: 'fora' });
  });
});

describe('POST /v1/auth/login', () => {
  it('devolve JWT de 15 min e o refresh em cookie httpOnly, Secure, SameSite=Strict, só em /v1/auth', async () => {
    const { app } = await montar();
    const r = await entrar(app);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ token_acesso: expect.any(String), expira_em: '2026-11-21T15:15:00.000Z' });
    const c = r.cookies.find((x) => x.name === COOKIE_REFRESH)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/auth' });
    expect(c.value.startsWith(`${TENANT}.`)).toBe(true);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('mesma resposta para empresa, e-mail ou senha errados (sem dizer qual)', async () => {
    const { app } = await montar();
    const respostas = await Promise.all([entrar(app, 'adm@exemplo.com', 'errada'), entrar(app, 'ninguem@exemplo.com'), entrar(app, 'adm@exemplo.com', SENHA, 'nao-existe')]);
    for (const r of respostas) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ codigo: 'NAO_AUTENTICADO', mensagem: 'Empresa, e-mail ou senha inválidos' });
    }
  });

  it('o e-mail de um tenant não entra em outro (D2)', async () => {
    const { app } = await montar();
    expect((await entrar(app, 'adm@exemplo.com', SENHA, 'outra')).statusCode).toBe(401);
  });

  it('trava após 5 falhas por 15 minutos e solta depois', async () => {
    const { app, relogio, repo } = await montar();
    for (let i = 0; i < 5; i++) expect((await entrar(app, 'adm@exemplo.com', 'errada')).statusCode).toBe(401);
    const travado = await entrar(app);
    expect(travado.statusCode).toBe(429);
    expect(travado.json()).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Acesso travado por 15 minutos após 5 tentativas' });
    relogio.avancar(15 * 60_000);
    expect((await entrar(app)).statusCode).toBe(200);
    expect(repo.usuarios.find((u) => u.id === ADM)).toMatchObject({ falhas_login: 0, bloqueado_ate: null });
  });

  it('corpo inválido é 400 VALIDACAO com os campos (também sem corpo ou JSON malformado)', async () => {
    const { app } = await montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'thathyany', email: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { email: expect.any(String), senha: expect.any(String) } });
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login' })).json()).toMatchObject({ codigo: 'VALIDACAO' });
    const malformado = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"empresa":' });
    expect(malformado.statusCode).toBe(400);
    expect(malformado.json().codigo).toBe('VALIDACAO');
  });
});

describe('refresh rotativo e saída', () => {
  it('troca o refresh a cada uso; o refresh reutilizado revoga a família inteira', async () => {
    const { app } = await montar();
    const r1 = refreshDe(await entrar(app));
    const renovado = await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r1 } });
    expect(renovado.statusCode).toBe(200);
    expect(renovado.json()).toEqual({ token_acesso: expect.any(String), expira_em: expect.any(String) });
    const r2 = refreshDe(renovado);
    expect(r2).not.toBe(r1);
    // reuso do r1 (roubado): 401 e o r2 também morre
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r1 } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r2 } })).statusCode).toBe(401);
  });

  it('sem cookie, malformado ou vencido é 401', async () => {
    const { app, relogio } = await montar();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: 'lixo' } })).statusCode).toBe(401);
    const r = refreshDe(await entrar(app));
    relogio.avancar(31 * 86_400_000);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r } })).statusCode).toBe(401);
  });

  it('sair revoga a sessão e limpa o cookie (idempotente)', async () => {
    const { app } = await montar();
    const r = refreshDe(await entrar(app));
    const saida = await app.inject({ method: 'POST', url: '/v1/auth/sair', cookies: { [COOKIE_REFRESH]: r } });
    expect(saida.statusCode).toBe(204);
    expect(saida.cookies.find((c) => c.name === COOKIE_REFRESH)?.value).toBe('');
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/sair' })).statusCode).toBe(204);
  });
});

describe('GET /v1/auth/eu', () => {
  it('sem token, token adulterado ou vencido é 401', async () => {
    const { app, relogio } = await montar();
    expect((await app.inject('/v1/auth/eu')).statusCode).toBe(401);
    const token: string = (await entrar(app)).json().token_acesso;
    expect((await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}x` } })).statusCode).toBe(401);
    relogio.avancar(15 * 60_000);
    expect((await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('responde no contrato EuResposta do SDK: usuário com perfil, razão social, filiais com nome e CNPJ e módulos licenciados', async () => {
    const { app } = await montar();
    const token: string = (await entrar(app, 'leitor@exemplo.com')).json().token_acesso;
    const r = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const eu = r.json();
    expect(EuResposta.parse(eu)).toEqual(eu);
    expect(eu).toEqual({
      usuario: { id: LEITOR, nome: 'Pessoa', perfil: 'leitura' },
      empresa: { id: TENANT, slug: 'thathyany', razao_social: 'Thathyany Comércio Ltda', fuso: 'America/Manaus' },
      // na ordem do cadastro do usuário; a filial de outro tenant não aparece (RLS)
      filiais: [
        { id: FILIAL_2, nome: 'Filial Parintins', cnpj: '11222333000262' },
        { id: MATRIZ, nome: 'Matriz Manaus', cnpj: '11222333000181' },
      ],
      modulos: [
        { id: 'core', menus: expect.any(Array) },
        { id: 'cadastros', menus: expect.arrayContaining(['Clientes']) },
      ],
      avisos_a1: [],
    });
  });

  it('T-0035 (RF-CORE-04): o selo do A1 vem dos avisos vigentes no instante do relógio, lidos na transação do tenant do usuário', async () => {
    const lidos: string[] = [];
    const avisosA1: LeitorAvisosA1 = async (tx, agora) => {
      lidos.push(`${tenantDaTx(tx)}:${agora.toISOString()}`);
      // campo a mais do adaptador não passa do contrato
      const linha = { filial_id: MATRIZ, dias: 12, valido_ate: new Date('2026-12-03T15:00:00Z'), certificado_id: FILIAL_2 };
      return [linha];
    };
    const { app, relogio } = await montar({ avisosA1 });
    const token: string = (await entrar(app)).json().token_acesso;
    const r = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().avisos_a1).toEqual([{ filial_id: MATRIZ, dias: 12, valido_ate: '2026-12-03T15:00:00.000Z' }]);
    expect(lidos).toEqual([`${TENANT}:${relogio.agora().toISOString()}`]);
  });

  it('dado fora do contrato é 500 ERRO_INTERNO (erro da plataforma), não 400 VALIDACAO', async () => {
    const { app, repo } = await montar();
    repo.filiais[0]!.cnpj = '11222333000180';
    const token: string = (await entrar(app)).json().token_acesso;
    const r = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(500);
    expect(r.json().codigo).toBe('ERRO_INTERNO');
  });
});

describe('rotas de módulo: ordem de checagem (RN-CORE-02)', () => {
  const postar = async (app: App, token: string | null, payload: unknown) =>
    app.inject({ method: 'POST', url: '/v1/cadastros/precos', payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('RN-CORE-02: 401 sem sessão, 403 PERFIL_SEM_PERMISSAO antes da licença, 403 MODULO_INATIVO sem licença', async () => {
    const { app, lidasEm } = await montar({ licencas: [] });
    expect((await postar(app, null, { preco_centavos: 1 })).statusCode).toBe(401);
    const leitor: string = (await entrar(app, 'leitor@exemplo.com')).json().token_acesso;
    expect((await postar(app, leitor, { preco_centavos: 1 })).json().codigo).toBe('PERFIL_SEM_PERMISSAO');
    expect(lidasEm).toEqual([]);
    const adm: string = (await entrar(app)).json().token_acesso;
    const r = await postar(app, adm, { preco_centavos: 1 });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('MODULO_INATIVO');
    expect(lidasEm).toEqual([TENANT]);
  });

  it('licenciado: valida o corpo (400), aplica RN (422) e executa na transação do tenant com evento e auditoria', async () => {
    const { app, outbox, auditoria, trabalhos } = await montar();
    const adm: string = (await entrar(app)).json().token_acesso;
    const invalido = await postar(app, adm, { preco_centavos: -1 });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { preco_centavos: expect.any(String) } });
    const regra = await postar(app, adm, { preco_centavos: 13 });
    expect(regra.statusCode).toBe(422);
    expect(regra.json()).toEqual({ codigo: 'RN-CAD-06', mensagem: 'preço fora da vigência' });
    const ok = await app.inject({ method: 'POST', url: '/v1/cadastros/precos', payload: { preco_centavos: 990 }, headers: { authorization: `Bearer ${adm}`, 'x-request-id': 'req-teste-0001' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ tenant: TENANT, versoes: [1, 2] });
    expect(ok.headers['x-request-id']).toBe('req-teste-0001');
    expect(outbox.eventos).toHaveLength(2);
    expect(outbox.eventos[0]).toMatchObject({ nome: 'cadastros.preco.alterado@1', tenant_id: TENANT, ator: ADM, request_id: 'req-teste-0001', ocorrido_em: '2026-11-21T15:00:00.000Z' });
    expect(auditoria.registros[0]).toMatchObject({ tenant_id: TENANT, usuario_id: ADM, request_id: 'req-teste-0001', acao: 'cadastros.preco.editar' });
    expect(trabalhos.pedidos).toEqual([expect.objectContaining({ tipo: 'cadastros.recalcular_precos', tenant_id: TENANT, external_id: 'p1' })]);
  });

  it('rota desconhecida é 404 NAO_ENCONTRADO', async () => {
    const { app } = await montar();
    expect((await app.inject('/v1/nada')).json()).toMatchObject({ codigo: 'NAO_ENCONTRADO' });
  });
});

describe('logs (LGPD e segredos)', () => {
  it('têm request_id, tenant_id e modulo, sem e-mail, senha, token, cookie nem query string', async () => {
    const logs: string[] = [];
    const { app } = await montar({ logs });
    const login = await entrar(app);
    const token: string = login.json().token_acesso;
    await app.inject({ method: 'POST', url: '/v1/cadastros/precos?busca=52998224725', payload: { preco_centavos: 5 }, headers: { authorization: `Bearer ${token}` } });
    const tudo = logs.join('\n');
    expect(tudo).toContain('"request_id"');
    expect(tudo).toContain(`"tenant_id":"${TENANT}"`);
    expect(tudo).toContain('"modulo":"cadastros"');
    for (const proibido of ['adm@exemplo.com', SENHA, token, refreshDe(login), '52998224725']) expect(tudo).not.toContain(proibido);
  });
});
