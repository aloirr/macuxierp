import { Writable } from 'node:stream';
import { definirPlugin, definirRota, erros, EuResposta, type FonteLicencas, type Licenca } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, IdempotenciaMemoria, OutboxMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COOKIE_REFRESH, criarApp, type LeitorAvisosA1 } from './app';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';
import { gerarHashSenha } from './auth/senha';
import { MENSAGEM_TROCAR_SENHA } from './auth/troca-senha';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE, modulosDeTeste, SENHA_DE_TESTE } from './apoio-teste';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const OUTRO_TENANT = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const ADM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const LEITOR = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const MATRIZ = '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e';
const FILIAL_2 = '4c5d6e7f-8a9b-4c0d-9e1f-3a4b5c6d7e8f';
const FILIAL_OUTRO_TENANT = '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a';
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
      if (e.corpo.preco_centavos === 14) throw erros.regra('RN-CAD-06', 'preço fora da vigência', { preco_centavos: 'fora' }, { possiveis: ['a', 'b'], limite: 3 });
      const v1 = await c.publicar({ nome: 'cadastros.preco.alterado@1', agregado_id: ADM, versao: 1, payload: { preco_centavos: e.corpo.preco_centavos } });
      const v2 = await c.publicar({ nome: 'cadastros.preco.alterado@1', agregado_id: ADM, versao: 7, payload: { preco_centavos: e.corpo.preco_centavos } });
      // versao omitida (T-0042): o padrão continua sendo a próxima versão do agregado na outbox
      const v3 = await c.publicar({ nome: 'cadastros.preco.alterado@1', agregado_id: ADM, payload: { preco_centavos: e.corpo.preco_centavos } });
      await c.auditar({ acao: 'cadastros.preco.editar', entidade: 'preco', entidade_id: ADM, depois: e.corpo });
      await c.enfileirar({ tipo: 'cadastros.recalcular_precos', payload: {}, external_id: 'p1' });
      return { status: 201, corpo: { tenant: tenantDaTx(c.tx), versoes: [v1.versao, v2.versao, v3.versao] } };
    },
  }),
  // T-0042: devolve o fuso do tenant que a API pôs no contexto
  definirRota({ metodo: 'GET', caminho: '/fuso', acao: 'cadastros.ver', executar: async (c) => ({ corpo: { fuso: c.fuso ?? null } }) }),
]);

async function montar(opcoes: { licencas?: Licenca[]; fonteLicencas?: FonteLicencas; logs?: string[]; avisosA1?: LeitorAvisosA1 } = {}) {
  hash ??= await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO);
  const banco = new BancoMemoria();
  const repo = new RepositorioAuthMemoria();
  const relogio = new RelogioFixo(INICIO);
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const trabalhos = new FilaDeTrabalhosMemoria();
  repo.tenants.push(
    { id: TENANT, slug: 'am2808', razao_social: 'Thathyany Comércio Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
    { id: OUTRO_TENANT, slug: 'am0002', razao_social: 'Outra Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
  );
  repo.filiais.push(
    { id: MATRIZ, tenant_id: TENANT, nome: 'Matriz Manaus', cnpj: '11222333000181' },
    { id: FILIAL_2, tenant_id: TENANT, nome: 'Filial Parintins', cnpj: '11222333000262' },
    { id: FILIAL_OUTRO_TENANT, tenant_id: OUTRO_TENANT, nome: 'De outro tenant', cnpj: '11444777000161' },
  );
  const usuario = { tenant_id: TENANT, nome: 'Pessoa', senha_hash: hash, ativo: true, falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: false };
  repo.usuarios.push(
    { ...usuario, id: ADM, email: 'adm@exemplo.com', perfil: 'administrador', filial_ids: [MATRIZ] },
    { ...usuario, id: LEITOR, email: 'leitor@exemplo.com', perfil: 'leitura', filial_ids: [FILIAL_2, MATRIZ, FILIAL_OUTRO_TENANT] },
  );
  const licencas = opcoes.licencas ?? [{ modulo: 'cadastros', ativo: true, valido_ate: null }];
  const lidasEm: (string | null)[] = [];
  const logs = opcoes.logs;
  const app = await criarApp({
    versao: '0.1.0',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: JWT_SEGREDO_DE_TESTE, argon2: ARGON2_RAPIDO },
    cookieSeguro: true,
    banco,
    repoAuth: repo,
    licencas: opcoes.fonteLicencas ?? { ler: async (tx) => (lidasEm.push(tenantDaTx(tx)), licencas) },
    outbox,
    auditoria,
    trabalhos,
    relogio,
    // o pedido montado de verdade (T-0016) declara Idempotency-Key no POST /pedidos
    idempotencia: new IdempotenciaMemoria(),
    avisosA1: opcoes.avisosA1 ?? (async () => []),
    modulos: [...MODULOS.filter((m) => m.manifesto.id !== 'cadastros'), pluginTeste],
    logger: logs ? { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) } : false,
  });
  apps.push(app);
  return { app, banco, repo, relogio, outbox, auditoria, trabalhos, lidasEm };
}

type App = Awaited<ReturnType<typeof montar>>['app'];

const entrar = (app: App, email = 'adm@exemplo.com', senha = SENHA_DE_TESTE, empresa = 'am2808') =>
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
    expect(r.json()).toEqual({ token_acesso: expect.any(String), expira_em: '2026-11-21T15:15:00.000Z', destino: 'bko' });
    const c = r.cookies.find((x) => x.name === COOKIE_REFRESH)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/auth' });
    expect(c.value.startsWith(`${TENANT}.`)).toBe(true);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('mesma resposta para empresa, e-mail ou senha errados (sem dizer qual)', async () => {
    const { app } = await montar();
    const respostas = await Promise.all([entrar(app, 'adm@exemplo.com', 'errada'), entrar(app, 'ninguem@exemplo.com'), entrar(app, 'adm@exemplo.com', SENHA_DE_TESTE, 'am9999')]);
    for (const r of respostas) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ codigo: 'NAO_AUTENTICADO', mensagem: 'Empresa, e-mail ou senha inválidos' });
    }
  });

  it('o e-mail de um tenant não entra em outro (D2)', async () => {
    const { app } = await montar();
    expect((await entrar(app, 'adm@exemplo.com', SENHA_DE_TESTE, 'am0002')).statusCode).toBe(401);
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
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'am2808', email: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { email: expect.any(String), senha: expect.any(String) } });
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login' })).json()).toMatchObject({ codigo: 'VALIDACAO' });
    const malformado = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"empresa":' });
    expect(malformado.statusCode).toBe(400);
    expect(malformado.json().codigo).toBe('VALIDACAO');
  });

  it('senha do login é SenhaInformada (1–200, sem a regra): 201 caracteres é 400 em senha, sem contar falha', async () => {
    const { app, repo } = await montar();
    const longa = await entrar(app, 'adm@exemplo.com', 'x'.repeat(201));
    expect(longa.statusCode).toBe(400);
    expect(longa.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { senha: expect.any(String) } });
    expect((await entrar(app, 'adm@exemplo.com', 'x'.repeat(200))).statusCode).toBe(401);
    expect(repo.usuarios.find((u) => u.id === ADM)).toMatchObject({ falhas_login: 1 });
  });
});

describe('refresh rotativo e saída', () => {
  it('troca o refresh a cada uso; o refresh reutilizado revoga a família inteira', async () => {
    const { app } = await montar();
    const r1 = refreshDe(await entrar(app));
    const renovado = await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r1 } });
    expect(renovado.statusCode).toBe(200);
    expect(renovado.json()).toEqual({ token_acesso: expect.any(String), expira_em: expect.any(String), destino: 'bko' });
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
      usuario: { id: LEITOR, nome: 'Pessoa', perfil: 'leitura', deve_trocar_senha: false },
      empresa: { id: TENANT, slug: 'am2808', razao_social: 'Thathyany Comércio Ltda', fuso: 'America/Manaus' },
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
    // T-0016: os detalhes estruturados do erro de regra saem no corpo, ao lado dos campos
    const comDetalhes = await postar(app, adm, { preco_centavos: 14 });
    expect(comDetalhes.statusCode).toBe(422);
    expect(comDetalhes.json()).toEqual({ codigo: 'RN-CAD-06', mensagem: 'preço fora da vigência', campos: { preco_centavos: 'fora' }, detalhes: { possiveis: ['a', 'b'], limite: 3 } });
    const ok = await app.inject({ method: 'POST', url: '/v1/cadastros/precos', payload: { preco_centavos: 990 }, headers: { authorization: `Bearer ${adm}`, 'x-request-id': 'req-teste-0001' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ tenant: TENANT, versoes: [1, 2, 3] });
    expect(ok.headers['x-request-id']).toBe('req-teste-0001');
    expect(outbox.eventos).toHaveLength(3);
    expect(outbox.eventos[2]).toMatchObject({ versao: 3 });
    expect(outbox.eventos[0]).toMatchObject({ nome: 'cadastros.preco.alterado@1', tenant_id: TENANT, ator: ADM, request_id: 'req-teste-0001', ocorrido_em: '2026-11-21T15:00:00.000Z' });
    expect(auditoria.registros[0]).toMatchObject({ tenant_id: TENANT, usuario_id: ADM, request_id: 'req-teste-0001', acao: 'cadastros.preco.editar' });
    expect(trabalhos.pedidos).toEqual([expect.objectContaining({ tipo: 'cadastros.recalcular_precos', tenant_id: TENANT, external_id: 'p1' })]);
  });

  it('rota desconhecida é 404 NAO_ENCONTRADO', async () => {
    const { app } = await montar();
    expect((await app.inject('/v1/nada')).json()).toMatchObject({ codigo: 'NAO_ENCONTRADO' });
  });
});

describe('ContextoRota.fuso (T-0042, regra 4)', () => {
  const fuso = async (app: App) => {
    const token = (await entrar(app)).json<{ token_acesso: string }>().token_acesso;
    const r = await app.inject({ url: '/v1/cadastros/fuso', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    return r.json<{ fuso: string | null }>().fuso;
  };

  it('a rota recebe o fuso do tenant da sessão (fonte de licenças sem fuso: lê o tenant)', async () => {
    const { app, repo } = await montar();
    expect(await fuso(app)).toBe('America/Manaus');
    repo.tenants[0]!.fuso = 'America/Sao_Paulo';
    expect(await fuso(app)).toBe('America/Sao_Paulo');
  });

  it('fonte com lerComFuso: o fuso vem da mesma leitura das licenças, sem ler o tenant', async () => {
    const lidas: string[] = [];
    const fonteLicencas = {
      ler: async () => Promise.reject(new Error('a API usa o lerComFuso')),
      lerComFuso: async (_tx: unknown, t: string) => (lidas.push(t), { licencas: [{ modulo: 'cadastros' as const, ativo: true, valido_ate: null }], fuso: 'America/Rio_Branco' }),
    };
    const { app, repo } = await montar({ fonteLicencas });
    const tenantPorId = repo.tenantPorId.bind(repo);
    let leuTenant = 0;
    repo.tenantPorId = async (tx, id) => (leuTenant++, tenantPorId(tx, id));
    expect(await fuso(app)).toBe('America/Rio_Branco');
    expect(lidas).toEqual([TENANT]);
    expect(leuTenant).toBe(0);
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
    for (const proibido of ['adm@exemplo.com', SENHA_DE_TESTE, token, refreshDe(login), '52998224725']) expect(tudo).not.toContain(proibido);
  });
});

describe('T-0052: log do 500 com o diagnóstico do banco, sem valor de coluna', () => {
  const VALOR_SENSIVEL = '52998224725';
  const errosDoLog = (logs: string[]) => logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === 'erro interno');
  async function falharNasLicencas(erro: Error) {
    const logs: string[] = [];
    const { app } = await montar({ logs, fonteLicencas: { ler: async () => { throw erro; } } });
    const token: string = (await entrar(app)).json().token_acesso;
    const r = await app.inject({ method: 'POST', url: '/v1/cadastros/precos', payload: { preco_centavos: 5 }, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(500);
    return logs;
  }

  it('erro do pg (23514): loga sqlstate, restricao e tabela; nunca message nem detail', async () => {
    const erro = Object.assign(new Error(`viola a restrição: cpf ${VALOR_SENSIVEL}`), {
      code: '23514',
      constraint: 'credencial_fdv_chave_check',
      table: 'credencial_fdv',
      detail: `Failing row contains (${VALOR_SENSIVEL}).`,
    });
    const logs = await falharNasLicencas(erro);
    const [log] = errosDoLog(logs);
    expect(log).toMatchObject({ sqlstate: '23514', restricao: 'credencial_fdv_chave_check', tabela: 'credencial_fdv', tipo: 'Error' });
    const tudo = logs.join('\n');
    expect(tudo).not.toContain(VALOR_SENSIVEL);
    expect(tudo).not.toContain('viola a restrição');
  });
});

describe('T-0052 (RN-CORE-10): senha provisória e POST /v1/auth/senha (repositório em memória)', () => {
  const SENHA_NOVA = 'Nova-senha-789';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const trocar = (app: App, token: string, refresh: string | null, corpo: unknown) =>
    app.inject({ method: 'POST', url: '/v1/auth/senha', headers: bearer(token), payload: corpo as object, ...(refresh ? { cookies: { [COOKIE_REFRESH]: refresh } } : {}) });

  async function comFlag() {
    const m = await montar();
    m.repo.usuarios.find((u) => u.id === ADM)!.deve_trocar_senha = true;
    const login = await entrar(m.app);
    return { ...m, token: login.json<{ token_acesso: string }>().token_acesso, refresh: refreshDe(login) };
  }

  it('com a flag: /eu mostra deve_trocar_senha, rota de módulo é 403 TROCAR_SENHA e sair responde', async () => {
    const { app, token, refresh } = await comFlag();
    const eu = await app.inject({ url: '/v1/auth/eu', headers: bearer(token) });
    expect(eu.statusCode).toBe(200);
    expect(eu.json().usuario).toEqual({ id: ADM, nome: 'Pessoa', perfil: 'administrador', deve_trocar_senha: true });
    const bloqueada = await app.inject({ url: '/v1/cadastros/fuso', headers: bearer(token) });
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json()).toEqual({ codigo: 'TROCAR_SENHA', mensagem: MENSAGEM_TROCAR_SENHA, motivo: 'provisoria' });
    expect((await app.inject({ method: 'POST', url: '/v1/cadastros/precos', headers: bearer(token), payload: { preco_centavos: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/sair', headers: bearer(token), cookies: { [COOKIE_REFRESH]: refresh } })).statusCode).toBe(204);
  });

  it('troca certa: 204, flag zerada, outras sessões revogadas, a corrente renova sem a flag; auditoria sem senha nem hash', async () => {
    const { app, repo, auditoria, token, refresh } = await comFlag();
    const outra = refreshDe(await entrar(app));
    const r = await trocar(app, token, refresh, { senha_atual: SENHA_DE_TESTE, senha_nova: SENHA_NOVA });
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    const u = repo.usuarios.find((x) => x.id === ADM)!;
    expect(u.deve_trocar_senha).toBe(false);
    expect(u.senha_hash).not.toBe(hash);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: outra } })).statusCode).toBe(401);
    const renovado = await app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: refresh } });
    expect(renovado.statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/cadastros/fuso', headers: bearer(renovado.json().token_acesso) })).statusCode).toBe(200);
    expect((await entrar(app, 'adm@exemplo.com', SENHA_NOVA)).statusCode).toBe(200);
    const aud = auditoria.registros.filter((a) => a.acao === 'core.usuario.senha_trocada');
    expect(aud).toEqual([expect.objectContaining({ tenant_id: TENANT, usuario_id: ADM, entidade: 'usuario', entidade_id: ADM, antes: null, depois: { sessoes_revogadas: 1 } })]);
    expect(JSON.stringify(aud)).not.toMatch(/argon2|Nova-senha|senha-de-teste/);
  });

  it('senha atual errada: 400 em senha_atual e não conta como falha de login', async () => {
    const { app, repo, token, refresh } = await comFlag();
    for (let i = 0; i < 6; i++) {
      const r = await trocar(app, token, refresh, { senha_atual: 'errada-123!', senha_nova: SENHA_NOVA });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { senha_atual: 'Senha atual incorreta. Confira e digite de novo.' } });
    }
    expect(repo.usuarios.find((u) => u.id === ADM)).toMatchObject({ falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: true });
    expect((await entrar(app)).statusCode).toBe(200);
  });

  it('nova igual à atual: 400 em senha_nova com a MENSAGEM_SENHA_IGUAL', async () => {
    const { app, token } = await comFlag();
    const r = await trocar(app, token, null, { senha_atual: SENHA_DE_TESTE, senha_nova: SENHA_DE_TESTE });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { senha_nova: 'A senha nova precisa ser diferente da atual' } });
  });

  it('nova fora da regra: 400 VALIDACAO com campos.senha_nova e detalhes.regras, antes de conferir a senha atual', async () => {
    const { app, token } = await comFlag();
    const r = await trocar(app, token, null, { senha_atual: 'qualquer', senha_nova: 'abcdefg' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({
      codigo: 'VALIDACAO',
      mensagem: 'A senha não atende às regras',
      campos: { senha_nova: '8 caracteres ou mais; Um número; Um caractere especial' },
      detalhes: { regras: ['caracteres', 'numero', 'especial'] },
    });
  });

  it('sem sessão é 401; corpo sem os campos é 400 VALIDACAO', async () => {
    const { app, token } = await comFlag();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/senha', payload: { senha_atual: 'a', senha_nova: SENHA_NOVA } })).statusCode).toBe(401);
    const r = await trocar(app, token, null, { senha_nova: SENHA_NOVA });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { senha_atual: expect.any(String) } });
  });
});
