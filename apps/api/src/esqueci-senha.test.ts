/**
 * T-0076 (v0.3.10): "Esqueci a senha" com a senha temporária e a tela única de login com o código da empresa.
 * Tenant pelo `RepositorioAuthMemoria`; superadmin por um dublê das funções da 0033 e da 0048 (pelo nome da função no SQL,
 * com as assinaturas combinadas); nada de Postgres aqui (o consumo concorrente no banco fica no esqueci-senha.db.test.ts).
 */
import { Writable } from 'node:stream';
import {
  CABECALHO_CSRF_CONFIG,
  CODIGO_TROCAR_SENHA,
  COOKIE_CONFIG,
  definirPlugin,
  definirPluginPlataforma,
  definirRota,
  definirRotaPlataforma,
  erroSenhaForaDaRegra,
  LoginResposta,
  MENSAGEM_ESQUECI_NEUTRA,
  MENSAGEM_FALHA_LOGIN,
  MuitasTentativasResposta,
  SenhaATrocarResposta,
  textoMuitasTentativas,
  type BancoPlataformaComLogin,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, OutboxMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_REFRESH, criarApp } from './app';
import { CLASSES_API } from './apoio-operador-teste';
import { ARGON2_RAPIDO, EnvioEmailMemoria, JWT_SEGREDO_DE_TESTE, modulosDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { aguardarSegundoPlanoEsqueci } from './auth/esqueci';
import { RepositorioAuthMemoria } from './auth/repositorio-memoria';
import * as senha from './auth/senha';
import { CLASSES_TEMPORARIA, gerarSenhaTemporaria, TAMANHO_TEMPORARIA } from './auth/senha-temporaria';
import { CONFIG_AUTH_PADRAO } from './auth/servico';

vi.mock('./auth/senha', async (original) => {
  const m = await original<typeof import('./auth/senha')>();
  return { ...m, gerarHashSenha: vi.fn(m.gerarHashSenha) };
});
const { conferirSenha, gerarHashSenha } = senha;
const hashes = vi.mocked(gerarHashSenha);

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const SUSPENSO = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const ADM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const INATIVO = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const DO_SUSPENSO = '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e';
const SA = '6e7f8a9b-0c1d-4e2f-8a3b-5c6d7e8f9a0b';
const SA_INATIVO = '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a';
const EMAIL_SA = 'superadmin@exemplo.com';
const TEMPORARIA = 'Temp-Abc23xyz!Q';
const SENHA_NOVA = 'Nova-senha-789';
const INICIO = new Date('2026-11-23T15:00:00Z');
const H72 = 72 * 3_600_000;
// T-0083: o texto único do 401 (o `MENSAGEM_FALHA_LOGIN` do SDK), escrito por extenso para o teste cair se ele mudar.
const NEUTRO_401 = { codigo: 'NAO_AUTENTICADO', mensagem: 'Empresa, e-mail ou senha incorretos.' };
/** Rota do tenant e rota do portal só para ver o 403 `TROCAR_SENHA` do bloqueio (o guard para antes de executar). */
const ROTA_TENANT = '/v1/cadastros/fuso';
const ROTA_PORTAL = '/v1/plataforma/empresas-teste';
const PLUGIN_TENANT = definirPlugin(modulosDeTeste().find((m) => m.manifesto.id === 'cadastros')!.manifesto, [
  definirRota({ metodo: 'GET', caminho: '/fuso', acao: 'cadastros.ver', executar: async () => ({ corpo: {} }) }),
]);
const PLUGIN_PORTAL = definirPluginPlataforma([
  definirRotaPlataforma({ metodo: 'GET', caminho: '/empresas-teste', acao: 'plataforma.empresa.ver', executar: async () => ({ status: 200, corpo: {} }) }),
]);

interface Superadmin {
  id: string;
  email: string;
  nome: string;
  senha_hash: string;
  ativo: boolean;
  falhas_login: number;
  bloqueado_ate: Date | null;
  deve_trocar_senha: boolean;
  senha_temporaria_hash: string | null;
  senha_temporaria_expira_em: Date | null;
}

/** Dublê das funções do superadmin (0033 + 0048), pelo nome da função no SQL. */
class BancoSuperadminDuble implements BancoPlataformaComLogin {
  readonly chamadas: string[] = [];
  readonly sessoes: { token_hash: string; superadmin_id: string; expira_em: Date; sessao_id: string }[] = [];
  /** Força o consumo a perder a corrida (outra sessão consumiu antes). */
  perderCorrida = false;
  constructor(
    readonly contas: Superadmin[],
    private readonly relogio: RelogioFixo,
  ) {}

  private conta(id: unknown): Superadmin {
    const sa = this.contas.find((c) => c.id === id);
    if (!sa) throw new Error('dublê: superadmin inexistente');
    return sa;
  }

  private sessaoAtual: string | null = null;

  private readonly tx: Transacao = {
    consultar: async <L,>(sql: string, p: readonly unknown[] = []): Promise<L[]> => {
      const funcao = /plataforma\.(\w+)\(/.exec(sql)?.[1] ?? sql;
      this.chamadas.push(funcao);
      switch (funcao) {
        case 'superadmin_para_login':
          // Sem diferenciar maiúsculas, para o teste ver que o "para" do e-mail é o da conta (T-0083), não o digitado.
          return this.contas.filter((c) => c.email.toLowerCase() === p[0]).map((c) => ({ ...c })) as L[];
        case 'superadmin_cancelar_temporaria': {
          // T-0083 (função nova do banco-dados): zera hash e validade só com a temporária presente; não mexe em deve_trocar_senha.
          const sa = this.conta(p[0]);
          const ok = sa.senha_temporaria_hash !== null;
          if (ok) Object.assign(sa, { senha_temporaria_hash: null, senha_temporaria_expira_em: null });
          return [{ ok }] as L[];
        }
        case 'superadmin_registrar_falha':
          Object.assign(this.conta(p[0]), { falhas_login: p[1], bloqueado_ate: p[2] });
          return [];
        case 'superadmin_consumir_temporaria': {
          const sa = this.conta(p[0]);
          const ok = !this.perderCorrida && !!sa.senha_temporaria_hash && !!sa.senha_temporaria_expira_em && sa.senha_temporaria_expira_em > this.relogio.agora();
          if (ok) Object.assign(sa, { senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: true });
          return [{ ok }] as L[];
        }
        case 'superadmin_emitir_temporaria':
          Object.assign(this.conta(p[0]), { senha_temporaria_hash: p[1], senha_temporaria_expira_em: p[2] });
          return [];
        case 'superadmin_abrir_sessao':
          this.conta(p[0]).falhas_login = 0;
          this.sessoes.push({ superadmin_id: p[0] as string, token_hash: p[1] as string, expira_em: p[2] as Date, sessao_id: `9${String(this.sessoes.length).padStart(7, '0')}-0000-4000-8000-000000000000` });
          return [];
        case 'superadmin_sessao_por_token': {
          const s = this.sessoes.find((x) => x.token_hash === p[0]);
          if (!s) return [];
          const sa = this.conta(s.superadmin_id);
          this.sessaoAtual = s.superadmin_id;
          return [{ sessao_id: s.sessao_id, superadmin_id: sa.id, nome: sa.nome, deve_trocar_senha: sa.deve_trocar_senha, expira_em: s.expira_em }] as L[];
        }
        case 'superadmin_senha_atual':
          return [{ h: this.conta(this.sessaoAtual).senha_hash }] as L[];
        case 'superadmin_trocar_senha': {
          const sa = this.conta(this.sessaoAtual);
          if (p[0] !== sa.senha_hash) throw Object.assign(new Error('senha mudou'), { code: '23514' });
          Object.assign(sa, { senha_hash: p[1], deve_trocar_senha: false, senha_temporaria_hash: null, senha_temporaria_expira_em: null });
          return [];
        }
        default:
          throw new Error(`dublê: função não esperada (${funcao})`);
      }
    },
  };

  antesDaSessao<R>(fn: (tx: Transacao) => Promise<R>): Promise<R> {
    return fn(this.tx);
  }
  comPlataforma<R>(s: { superadmin_id: string }, fn: (tx: Transacao) => Promise<R>): Promise<R> {
    this.sessaoAtual = s.superadmin_id;
    return fn(this.tx);
  }
}

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
beforeEach(() => {
  hashes.mockClear();
});

async function montar(o: { semEmail?: boolean } = {}) {
  const relogio = new RelogioFixo(INICIO);
  const hash = await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO);
  const repo = new RepositorioAuthMemoria(() => relogio.agora());
  repo.tenants.push(
    { id: TENANT, slug: 'am2808', razao_social: 'Loja Exemplo Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
    { id: SUSPENSO, slug: 'am1234', razao_social: 'Suspensa Ltda', fuso: 'America/Manaus', situacao: 'suspenso' },
  );
  const base = { nome: 'Pessoa', senha_hash: hash, perfil: 'administrador' as const, filial_ids: [], ativo: true, falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: false };
  repo.usuarios.push(
    { ...base, id: ADM, tenant_id: TENANT, email: 'adm@exemplo.com' },
    { ...base, id: INATIVO, tenant_id: TENANT, email: 'inativo@exemplo.com', ativo: false },
    { ...base, id: DO_SUSPENSO, tenant_id: SUSPENSO, email: 'susp@exemplo.com' },
  );
  const sa: Superadmin = { id: SA, email: EMAIL_SA, nome: 'Operação', senha_hash: hash, ativo: true, falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: false, senha_temporaria_hash: null, senha_temporaria_expira_em: null };
  const saInativo: Superadmin = { ...sa, id: SA_INATIVO, email: 'antigo@exemplo.com', ativo: false };
  const plataforma = new BancoSuperadminDuble([sa, saInativo], relogio);
  const banco = new BancoMemoria();
  let respondido = false;
  const envio = new EnvioEmailMemoria(() => respondido);
  const auditoria = new AuditoriaMemoria();
  const logs: string[] = [];
  // Dublê do `emitirSenhaTemporaria` e do `cancelarSenhaTemporaria` (T-0083) do `RepositorioCore` sobre os usuários do
  // repositório de auth em memória, com a RLS do tenant.
  const cancelamentos: string[] = [];
  const repoCore = {
    async emitirSenhaTemporaria(tx: Transacao, usuarioId: string, hash: string, expiraEm: Date) {
      const u = repo.usuarios.find((x) => x.id === usuarioId && x.tenant_id === tenantDaTx(tx));
      if (!u) throw new Error('usuário fora do tenant');
      Object.assign(u, { senha_temporaria_hash: hash, senha_temporaria_expira_em: expiraEm });
    },
    async cancelarSenhaTemporaria(tx: Transacao, usuarioId: string) {
      cancelamentos.push(usuarioId);
      const u = repo.usuarios.find((x) => x.id === usuarioId && x.tenant_id === tenantDaTx(tx));
      if (!u?.senha_temporaria_hash) return false;
      Object.assign(u, { senha_temporaria_hash: null, senha_temporaria_expira_em: null });
      return true;
    },
  };
  const app = await criarApp({
    versao: '0.3.10',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: JWT_SEGREDO_DE_TESTE, argon2: ARGON2_RAPIDO },
    cookieSeguro: true,
    banco,
    repoAuth: repo,
    licencas: { ler: async () => [] },
    outbox: new OutboxMemoria(),
    auditoria,
    trabalhos: new FilaDeTrabalhosMemoria(),
    relogio,
    modulos: [PLUGIN_TENANT],
    plataforma: { banco: plataforma, plugins: [PLUGIN_PORTAL], segredoBff: null },
    cancelarTemporaria: repoCore,
    ...(o.semEmail ? {} : { esqueci: { envio, repoCore } }),
    logger: { level: 'info', stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) },
  });
  apps.push(app);
  /** `inject` que marca o instante da resposta: o envio que rodar antes disso fica com `depoisDaResposta: false`. */
  const chamar = async (p: InjectOptions) => {
    respondido = false;
    const r = await app.inject(p);
    respondido = true;
    return r;
  };
  const adm = repo.usuarios.find((u) => u.id === ADM)!;
  return { app, chamar, repo, adm, sa, plataforma, banco, envio, auditoria, logs, relogio, cancelamentos };
}

type Montado = Awaited<ReturnType<typeof montar>>;
const csrf = { [CABECALHO_CSRF_CONFIG]: '1' };
/** Login pela tela única, como a web manda: sempre com o `CABECALHO_CSRF_CONFIG` (ADR 0018 §5). */
const login = (m: Montado, empresa: string, email: string, s: string, ip = '203.0.113.1', headers: Record<string, string> = csrf) =>
  m.chamar({ method: 'POST', url: '/v1/auth/login', headers: { ...headers, 'cf-connecting-ip': ip }, payload: { empresa, email, senha: s } });
/** Esqueci pela tela única, como o login: com o `CABECALHO_CSRF_CONFIG` (o código MACUXI o exige, T-0083). */
const esqueci = (m: Montado, empresa: string, email: string, ip = '203.0.113.7', headers: Record<string, string> = csrf) =>
  m.chamar({ method: 'POST', url: '/v1/auth/esqueci', headers: { ...headers, 'cf-connecting-ip': ip }, payload: { empresa, email } });
/** T-0083: o pedido roda em segundo plano, depois do 202; espera ele (e o envio agendado) terminar. */
const esperarSegundoPlano = async (m: Montado) => {
  await aguardarSegundoPlanoEsqueci();
  await m.envio.esperar();
};
const esqueciConfig = (m: Montado, email: string, ip = '203.0.113.7') =>
  m.chamar({ method: 'POST', url: '/v1/plataforma/auth/esqueci', headers: { ...csrf, 'cf-connecting-ip': ip }, payload: { email } });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const cookie = (r: { cookies: { name: string; value: string }[] }, nome: string) => r.cookies.find((c) => c.name === nome)?.value;

async function comTemporaria<T extends { senha_temporaria_hash?: string | null; senha_temporaria_expira_em?: Date | null }>(conta: T, validadeMs = H72): Promise<T> {
  conta.senha_temporaria_hash = await gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
  conta.senha_temporaria_expira_em = new Date(INICIO.getTime() + validadeMs);
  return conta;
}

describe('T-0076: senha temporária gerada como a do operador.sh', () => {
  it('16 caracteres, um de cada classe, só do alfabeto do operador.sh e da API, e cumpre a regra única', () => {
    expect([...CLASSES_TEMPORARIA]).toEqual([CLASSES_API.MAIUSCULAS, CLASSES_API.MINUSCULAS, CLASSES_API.DIGITOS, CLASSES_API.SIMBOLOS]);
    const alfabeto = CLASSES_TEMPORARIA.join('');
    const vistas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = gerarSenhaTemporaria();
      expect(s).toHaveLength(TAMANHO_TEMPORARIA);
      expect([...s].every((c) => alfabeto.includes(c))).toBe(true);
      for (const classe of CLASSES_TEMPORARIA) expect([...s].some((c) => classe.includes(c))).toBe(true);
      expect(erroSenhaForaDaRegra(s)).toBeNull();
      vistas.add(s);
    }
    expect(vistas.size).toBe(200);
  });
});

describe('T-0076: login do tenant com a temporária', () => {
  it('T-0083 (RN-CORE-13): a senha atual vale com a temporária pendente (200, destino bko), cancela a temporária na mesma transação e audita o cancelamento sem senha nem e-mail', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    const r = await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ token_acesso: expect.any(String), expira_em: expect.any(String), destino: 'bko' });
    expect(LoginResposta.parse(r.json())).toMatchObject({ destino: 'bko' });
    expect(m.cancelamentos).toEqual([ADM]);
    expect(m.adm).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: false });
    const cancelada = m.auditoria.registros.filter((a) => a.acao === 'core.usuario.senha_temporaria_cancelada');
    expect(cancelada.map((a) => [a.tenant_id, a.usuario_id, a.entidade, a.entidade_id])).toEqual([[TENANT, ADM, 'usuario', ADM]]);
    expect(cancelada[0]).toMatchObject({ antes: null, depois: null });
    expect(JSON.stringify(cancelada)).not.toMatch(/exemplo\.com|argon2|Temp-/i);
    // a temporária não vale mais (401 neutro, conta como falha)
    const depois = await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA);
    expect(depois.statusCode).toBe(401);
    expect(depois.json()).toEqual(NEUTRO_401);
    // sem temporária pendente, o login certo não chama o cancelamento nem audita
    expect((await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE)).statusCode).toBe(200);
    expect(m.cancelamentos).toEqual([ADM]);
    expect(m.auditoria.registros.filter((a) => a.acao === 'core.usuario.senha_temporaria_cancelada')).toHaveLength(1);
  });

  it('T-0083: a temporária vencida também é cancelada no login certo com a senha atual', async () => {
    const m = await montar();
    await comTemporaria(m.adm, 60_000);
    m.relogio.avancar(60_000);
    expect((await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE)).statusCode).toBe(200);
    expect(m.adm).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null });
    expect(m.auditoria.registros.map((a) => a.acao)).toEqual(['core.usuario.senha_temporaria_cancelada']);
  });

  it('T-0083: senha errada com a temporária pendente não cancela', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    expect((await login(m, 'am2808', 'adm@exemplo.com', 'errada-1')).statusCode).toBe(401);
    expect(m.cancelamentos).toEqual([]);
    expect(m.adm.senha_temporaria_hash).toBeTruthy();
  });

  it('com a temporária: o login é 200 LoginResposta bko com a sessão; as outras rotas dão 403 SenhaATrocarResposta (motivo temporaria, expira_em = fim das 72 h); as colunas zeram; o segundo uso dá 401; a antiga ainda vale', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    const fim = m.adm.senha_temporaria_expira_em!.toISOString();
    const r = await login(m, ' am2808 ', 'adm@exemplo.com', TEMPORARIA, '203.0.113.1', {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ destino: 'bko', token_acesso: expect.any(String), expira_em: expect.any(String) });
    expect(LoginResposta.parse(r.json())).toMatchObject({ destino: 'bko' });
    expect(cookie(r, COOKIE_REFRESH)).toMatch(new RegExp(`\\.t${Date.parse(fim) / 1000}$`));
    expect(m.adm).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: true });
    const token = r.json<{ token_acesso: string }>().token_acesso;
    const eu = await m.app.inject({ url: '/v1/auth/eu', headers: bearer(token) });
    expect(eu.json().usuario).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
    const bloqueada = await m.app.inject({ url: ROTA_TENANT, headers: bearer(token) });
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json()).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: expect.any(String), motivo: 'temporaria', expira_em: fim });
    expect(SenhaATrocarResposta.parse(bloqueada.json())).toEqual(bloqueada.json());
    const segundo = await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA);
    expect(segundo.statusCode).toBe(401);
    expect(segundo.json()).toEqual(NEUTRO_401);
    expect((await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE)).statusCode).toBe(200);
  });

  it('temporária vencida: 401 neutro, conta como falha e não liga a troca', async () => {
    const m = await montar();
    await comTemporaria(m.adm, 60_000);
    m.relogio.avancar(60_000);
    const r = await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual(NEUTRO_401);
    expect(m.adm).toMatchObject({ falhas_login: 1, deve_trocar_senha: false });
  });

  it('temporária errada conta em falhas_login e na trava, igual à senha errada', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    for (let i = 0; i < 5; i++) expect((await login(m, 'am2808', 'adm@exemplo.com', 'Temp-errada-9!')).statusCode).toBe(401);
    expect(m.adm.bloqueado_ate).not.toBeNull();
    // travada: nem a temporária certa entra
    expect((await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA)).statusCode).toBe(429);
    expect(m.adm.senha_temporaria_hash).toBeTruthy();
  });

  it('corrida do consumo: quem perde recebe 401 neutro e nenhuma sessão abre', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    const consumir = m.repo.consumirTemporaria.bind(m.repo);
    // a outra sessão consome entre a leitura e o UPDATE
    m.repo.consumirTemporaria = async (tx, id) => (await consumir(tx, id), consumir(tx, id));
    const r = await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual(NEUTRO_401);
    expect(m.repo.sessoes).toHaveLength(0);
    expect(m.adm.falhas_login).toBe(0);
  });

  it('troca com o motivo temporaria sem a senha atual (também depois do refresh); depois só a nova e a antiga não valem', async () => {
    const m = await montar();
    await comTemporaria(m.adm);
    const r = await login(m, 'am2808', 'adm@exemplo.com', TEMPORARIA);
    const renovado = await m.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: cookie(r, COOKIE_REFRESH)! } });
    expect(renovado.statusCode).toBe(200);
    expect(cookie(renovado, COOKIE_REFRESH)).toMatch(/\.t\d+$/);
    const token = renovado.json<{ token_acesso: string }>().token_acesso;
    // o refresh leva o motivo e o fim da temporária: o 403 do bloqueio continua com o mesmo expira_em
    expect((await m.app.inject({ url: ROTA_TENANT, headers: bearer(token) })).json()).toMatchObject({ motivo: 'temporaria', expira_em: new Date(INICIO.getTime() + H72).toISOString() });
    const troca = await m.app.inject({ method: 'POST', url: '/v1/auth/senha', headers: bearer(token), cookies: { [COOKIE_REFRESH]: cookie(renovado, COOKIE_REFRESH)! }, payload: { senha_nova: SENHA_NOVA } });
    expect(troca.statusCode).toBe(204);
    expect(m.adm).toMatchObject({ deve_trocar_senha: false, senha_temporaria_hash: null, senha_temporaria_expira_em: null });
    expect((await login(m, 'am2808', 'adm@exemplo.com', SENHA_NOVA)).statusCode).toBe(200);
    expect((await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE)).statusCode).toBe(401);
  });

  it('fora do motivo temporaria (senha provisória comum), a troca sem a senha atual é 400 em senha_atual', async () => {
    const m = await montar();
    m.adm.deve_trocar_senha = true;
    const r = await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE);
    const token = r.json<{ token_acesso: string }>().token_acesso;
    // o bloqueio da provisória: motivo provisoria, sem expira_em
    expect((await m.app.inject({ url: ROTA_TENANT, headers: bearer(token) })).json()).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: expect.any(String), motivo: 'provisoria' });
    const troca = await m.app.inject({ method: 'POST', url: '/v1/auth/senha', headers: bearer(token), payload: { senha_nova: SENHA_NOVA } });
    expect(troca.statusCode).toBe(400);
    expect(troca.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { senha_atual: expect.any(String) } });
    expect(m.adm.deve_trocar_senha).toBe(true);
  });

  it('sessão comum (sem troca pendente): a troca sem a senha atual é 400 VALIDACAO em senha_atual', async () => {
    const m = await montar();
    const token = (await login(m, 'am2808', 'adm@exemplo.com', SENHA_DE_TESTE)).json<{ token_acesso: string }>().token_acesso;
    const troca = await m.app.inject({ method: 'POST', url: '/v1/auth/senha', headers: bearer(token), payload: { senha_nova: SENHA_NOVA } });
    expect(troca.statusCode).toBe(400);
    expect(troca.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { senha_atual: expect.any(String) } });
  });
});

describe('T-0076: POST /v1/auth/esqueci (tenant)', () => {
  it('202 idêntico para conta existente, inexistente, inativa, de empresa suspensa e de empresa inexistente; o argon2 roda em todas', async () => {
    const m = await montar();
    const casos: [string, string][] = [
      ['AM2808', ' ADM@exemplo.com '],
      ['AM2808', 'ninguem@exemplo.com'],
      ['AM2808', 'inativo@exemplo.com'],
      ['AM1234', 'susp@exemplo.com'],
      ['SP9999', 'adm@exemplo.com'],
    ];
    const respostas = [];
    for (const [i, [empresa, email]] of casos.entries()) {
      hashes.mockClear();
      const r = await esqueci(m, empresa, email, `198.51.100.${i + 1}`);
      await esperarSegundoPlano(m);
      expect(hashes).toHaveBeenCalledTimes(1);
      respostas.push(r);
    }
    for (const r of respostas) {
      expect(r.statusCode).toBe(202);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toBe(respostas[0]!.body);
    }
    expect(respostas[0]!.json()).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
    expect(MENSAGEM_ESQUECI_NEUTRA).toBe('Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas.');
    await esperarSegundoPlano(m);
    // só a conta existente grava, audita e recebe
    expect(m.envio.enviados.map((e) => e.para)).toEqual(['adm@exemplo.com']);
    expect(m.repo.usuarios.filter((u) => u.senha_temporaria_hash).map((u) => u.id)).toEqual([ADM]);
    expect(m.auditoria.registros.map((a) => [a.acao, a.tenant_id, a.usuario_id, a.entidade_id])).toEqual([['core.usuario.senha_esquecida', TENANT, ADM, ADM]]);
    const [enviado] = m.envio.enviados;
    const temporaria = /Senha temporária: (\S+)/.exec(enviado!.texto)?.[1];
    expect(temporaria).toHaveLength(16);
    expect(enviado!.assunto).toBe('Macuxi ERP: sua senha temporária');
    expect(enviado!.texto).toContain('Ela vale por 72 horas');
    expect(m.adm.senha_temporaria_hash).toMatch(/^\$argon2id\$/);
    expect(await conferirSenha(temporaria!, m.adm.senha_temporaria_hash!)).toBe(true);
    expect(m.adm.senha_temporaria_expira_em!.getTime() - INICIO.getTime()).toBe(H72);
    for (const r of respostas) expect(r.body).not.toContain(temporaria);
    // a temporária entregue entra (200), com a troca obrigatória
    expect((await login(m, 'am2808', 'adm@exemplo.com', temporaria!)).statusCode).toBe(200);
    expect(m.adm.deve_trocar_senha).toBe(true);
  });

  it('um pedido novo substitui o anterior: a primeira temporária deixa de valer', async () => {
    const m = await montar();
    await esqueci(m, 'AM2808', 'adm@exemplo.com');
    await esperarSegundoPlano(m);
    await esqueci(m, 'AM2808', 'adm@exemplo.com');
    await esperarSegundoPlano(m);
    const [primeira, segunda] = m.envio.enviados.map((e) => /Senha temporária: (\S+)/.exec(e.texto)![1]!);
    expect(primeira).not.toBe(segunda);
    expect((await login(m, 'am2808', 'adm@exemplo.com', primeira!)).statusCode).toBe(401);
    expect((await login(m, 'am2808', 'adm@exemplo.com', segunda!)).statusCode).toBe(200);
  });

  it('o envio só sai depois da resposta', async () => {
    const m = await montar();
    const r = await esqueci(m, 'AM2808', 'adm@exemplo.com');
    expect(r.statusCode).toBe(202);
    expect(m.envio.enviados).toHaveLength(0);
    await esperarSegundoPlano(m);
    expect(m.envio.enviados).toHaveLength(1);
    expect(m.envio.enviados[0]!.depoisDaResposta).toBe(true);
  });

  it('429 por IP (5 a cada 15 min) antes do banco: MuitasTentativasResposta com detalhes.retry_after_s, e no Retry-After', async () => {
    const m = await montar();
    for (let i = 0; i < 5; i++) expect((await esqueci(m, 'AM2808', `p${i}@exemplo.com`)).statusCode).toBe(202);
    await esperarSegundoPlano(m);
    const aberturas = m.banco.aberturas.length;
    hashes.mockClear();
    const r = await esqueci(m, 'AM2808', 'adm@exemplo.com');
    expect(r.statusCode).toBe(429);
    expect(r.json()).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: textoMuitasTentativas(900), detalhes: { retry_after_s: 900 } });
    expect(MuitasTentativasResposta.safeParse(r.json()).success).toBe(true);
    expect(r.headers['retry-after']).toBe('900');
    await esperarSegundoPlano(m);
    expect(m.banco.aberturas).toHaveLength(aberturas);
    expect(hashes).not.toHaveBeenCalled();
  });

  it('429 por conta (3 por hora, empresa + e-mail), mesmo trocando de IP, igual para conta que existe ou não, antes do banco', async () => {
    const m = await montar();
    for (const email of ['adm@exemplo.com', 'ninguem@exemplo.com']) {
      for (let i = 0; i < 3; i++) expect((await esqueci(m, 'AM2808', email, `198.51.100.${i + 10}`)).statusCode).toBe(202);
    }
    m.relogio.avancar(10 * 60_000);
    await esperarSegundoPlano(m);
    const aberturas = m.banco.aberturas.length;
    const existe = await esqueci(m, 'am2808', 'ADM@exemplo.com', '198.51.100.50');
    const naoExiste = await esqueci(m, 'AM2808', 'ninguem@exemplo.com', '198.51.100.51');
    for (const r of [existe, naoExiste]) {
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS', detalhes: { retry_after_s: 50 * 60 } });
    }
    expect(existe.body).toBe(naoExiste.body);
    await esperarSegundoPlano(m);
    expect(m.banco.aberturas).toHaveLength(aberturas);
  });

  it('corpo inválido é 400 VALIDACAO (CodigoEmpresaLogin fora do código e do slug; e-mail válido)', async () => {
    const m = await montar();
    // Inválidos também no formato do slug antigo que o CodigoEmpresaLogin aceita (PADRAO_SLUG_EMPRESA, CHECK da 0002):
    // curto demais, espaço, sublinhado, hífen no início e mais de 40 caracteres.
    for (const [i, corpo] of [{ empresa: 'A', email: 'adm@exemplo.com' }, { empresa: 'AM 2808', email: 'adm@exemplo.com' }, { empresa: 'loja_exemplo', email: 'adm@exemplo.com' }, { empresa: '-am2808', email: 'adm@exemplo.com' }, { empresa: `A${'M'.repeat(40)}`, email: 'adm@exemplo.com' }, { empresa: 'AM2808', email: 'x' }, { empresa: 'MACUXI', email: 'x' }].entries()) {
      const r = await m.app.inject({ method: 'POST', url: '/v1/auth/esqueci', headers: { 'cf-connecting-ip': `198.51.100.${200 + i}` }, payload: corpo });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'VALIDACAO' });
    }
  });

  it('nenhum e-mail nem temporária em log, nem quando o envio falha', async () => {
    const m = await montar();
    m.envio.falhar = true;
    await esqueci(m, 'AM2808', 'adm@exemplo.com');
    await esqueci(m, 'MACUXI', EMAIL_SA, '203.0.113.9');
    await esperarSegundoPlano(m);
    // agendarEnvioEmail: 2 tentativas com 2 s entre elas; a falha final é um `warn` sem dado pessoal.
    await new Promise((r) => setTimeout(r, 2300));
    await m.envio.esperar();
    const texto = m.logs.join('\n');
    expect(texto).toContain('e-mail não enviado após as tentativas');
    expect(texto).not.toMatch(/exemplo\.com|Senha temporária/i);
  });

  it('GET /v1/auth/esqueci/situacao: true com a porta de e-mail; sem ela, false', async () => {
    const com = await montar();
    expect((await com.app.inject({ url: '/v1/auth/esqueci/situacao' })).json()).toEqual({ esqueci_disponivel: true });
    const sem = await montar({ semEmail: true });
    expect((await sem.app.inject({ url: '/v1/auth/esqueci/situacao' })).json()).toEqual({ esqueci_disponivel: false });
  });

  it('e-mail desligado: as rotas seguem montadas e respondem o mesmo 202 neutro, com o mesmo argon2, sem banco, sem temporária e sem envio', async () => {
    const sem = await montar({ semEmail: true });
    hashes.mockClear();
    const rs = [
      await esqueci(sem, 'AM2808', 'adm@exemplo.com', '198.51.100.1'),
      await esqueci(sem, 'AM2808', 'ninguem@exemplo.com', '198.51.100.2'),
      await esqueci(sem, 'MACUXI', EMAIL_SA, '198.51.100.3'),
      await esqueciConfig(sem, EMAIL_SA, '198.51.100.4'),
    ];
    for (const r of rs) {
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toBe(rs[0]!.body);
    }
    // O mesmo custo do pedido com e-mail: um argon2 por pedido, conta existente ou não (em segundo plano).
    await esperarSegundoPlano(sem);
    expect(hashes).toHaveBeenCalledTimes(rs.length);
    expect(sem.envio.enviados).toEqual([]);
    expect(sem.banco.aberturas).toHaveLength(0);
    expect(sem.plataforma.chamadas).toEqual([]);
    expect(sem.adm.senha_temporaria_hash ?? null).toBeNull();
    expect(sem.sa).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null });
  });

  it('e-mail desligado: os 429 por IP e por conta valem antes do 202 (e antes do argon2)', async () => {
    const sem = await montar({ semEmail: true });
    for (let i = 0; i < 5; i++) expect((await esqueci(sem, 'AM2808', `p${i}@exemplo.com`)).statusCode).toBe(202);
    await esperarSegundoPlano(sem);
    hashes.mockClear();
    const ip = await esqueci(sem, 'AM2808', 'adm@exemplo.com');
    expect(ip.statusCode).toBe(429);
    expect(ip.json()).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: textoMuitasTentativas(900), detalhes: { retry_after_s: 900 } });
    expect(hashes).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) expect((await esqueciConfig(sem, EMAIL_SA, `198.51.100.${i + 20}`)).statusCode).toBe(202);
    const conta = await esqueci(sem, 'MACUXI', EMAIL_SA, '198.51.100.30');
    expect(conta.statusCode).toBe(429);
    expect(conta.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS', detalhes: { retry_after_s: 3600 } });
    await esperarSegundoPlano(sem);
    expect(sem.banco.aberturas).toHaveLength(0);
    expect(sem.plataforma.chamadas).toEqual([]);
  });
});

describe('T-0076: tela única com o código MACUXI', () => {
  it('login MACUXI (sem diferenciar maiúsculas): 200 com destino config e o cookie do /config, sem o refresh do tenant', async () => {
    const m = await montar();
    const r = await login(m, ' macuxi ', ` ${EMAIL_SA.toUpperCase()} `, SENHA_DE_TESTE);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ expira_em: expect.any(String), destino: 'config' });
    expect(LoginResposta.parse(r.json())).toEqual(r.json());
    expect(r.cookies.find((c) => c.name === COOKIE_CONFIG)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/plataforma' });
    expect(cookie(r, COOKIE_REFRESH)).toBeUndefined();
    const eu = await m.app.inject({ url: '/v1/plataforma/auth/eu', cookies: { [COOKIE_CONFIG]: cookie(r, COOKIE_CONFIG)! } });
    expect(eu.json()).toMatchObject({ superadmin: { id: SA }, deve_trocar_senha: false });
  });

  it('o 401 é idêntico nos dois lados: tenant, MACUXI com senha errada, MACUXI sem conta, MACUXI inativo', async () => {
    const m = await montar();
    const rs = [
      await login(m, 'AM2808', 'adm@exemplo.com', 'errada-1'),
      await login(m, 'AM2808', 'ninguem@exemplo.com', 'errada-1'),
      await login(m, 'MACUXI', EMAIL_SA, 'errada-1'),
      await login(m, 'MACUXI', 'ninguem@exemplo.com', 'errada-1'),
      await login(m, 'MACUXI', 'antigo@exemplo.com', SENHA_DE_TESTE),
    ];
    for (const r of rs) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toBe(JSON.stringify(NEUTRO_401));
    }
  });

  it('o limite de login por IP vale nos dois lados: 10 falhas a cada 15 min, somadas; o login certo não conta', async () => {
    const m = await montar();
    for (let i = 0; i < 12; i++) expect((await login(m, i % 2 ? 'MACUXI' : 'AM2808', i % 2 ? EMAIL_SA : 'adm@exemplo.com', SENHA_DE_TESTE, '192.0.2.1')).statusCode).toBe(200);
    for (let i = 0; i < 10; i++) expect((await login(m, i % 2 ? 'MACUXI' : 'AM2808', `p${i}@exemplo.com`, 'errada-1', '192.0.2.1')).statusCode).toBe(401);
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE, '192.0.2.1')).json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS' });
    expect((await login(m, 'AM2808', 'adm@exemplo.com', SENHA_DE_TESTE, '192.0.2.1')).statusCode).toBe(429);
    expect((await login(m, 'AM2808', 'adm@exemplo.com', SENHA_DE_TESTE, '192.0.2.2')).statusCode).toBe(200);
    m.relogio.avancar(15 * 60_000);
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE, '192.0.2.1')).statusCode).toBe(200);
  });

  it('MACUXI sem o CABECALHO_CSRF_CONFIG (ADR 0018 §5): o mesmo 401 neutro, sem banco e com o argon2; o tenant não exige o cabeçalho', async () => {
    const m = await montar();
    hashes.mockClear();
    const r = await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE, '203.0.113.2', {});
    expect(r.statusCode).toBe(401);
    expect(r.body).toBe(JSON.stringify(NEUTRO_401));
    expect(cookie(r, COOKIE_CONFIG)).toBeUndefined();
    expect(m.plataforma.chamadas).toEqual([]);
    expect(m.sa.falhas_login).toBe(0);
    const errado = await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE, '203.0.113.2', { [CABECALHO_CSRF_CONFIG]: '0' });
    expect(errado.body).toBe(JSON.stringify(NEUTRO_401));
    expect((await login(m, 'AM2808', 'adm@exemplo.com', SENHA_DE_TESTE, '203.0.113.2', {})).statusCode).toBe(200);
  });

  it('MACUXI com a temporária: 200 LoginResposta config com o cookie; as rotas do portal dão 403 SenhaATrocarResposta (motivo temporaria, expira_em); o segundo uso dá 401; a antiga vale', async () => {
    const m = await montar();
    await comTemporaria(m.sa);
    const fim = m.sa.senha_temporaria_expira_em!.toISOString();
    const r = await login(m, 'MACUXI', EMAIL_SA, TEMPORARIA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    expect(LoginResposta.parse(r.json())).toEqual(r.json());
    expect(cookie(r, COOKIE_CONFIG)).toMatch(new RegExp(`^t${Date.parse(fim) / 1000}\\.`));
    const bloqueada = await m.app.inject({ url: ROTA_PORTAL, cookies: { [COOKIE_CONFIG]: cookie(r, COOKIE_CONFIG)! } });
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json()).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: expect.any(String), motivo: 'temporaria', expira_em: fim });
    expect(SenhaATrocarResposta.parse(bloqueada.json())).toEqual(bloqueada.json());
    expect(m.plataforma.chamadas).toContain('superadmin_consumir_temporaria');
    expect(m.sa).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: true });
    const segundo = await login(m, 'MACUXI', EMAIL_SA, TEMPORARIA);
    expect(segundo.body).toBe(JSON.stringify(NEUTRO_401));
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE)).statusCode).toBe(200);
  });

  it('superadmin: troca com o motivo temporaria sem a senha atual; sessão comum com troca pendente ainda exige a atual', async () => {
    const m = await montar();
    await comTemporaria(m.sa);
    const r = await login(m, 'MACUXI', EMAIL_SA, TEMPORARIA);
    const cfg = { [COOKIE_CONFIG]: cookie(r, COOKIE_CONFIG)! };
    expect((await m.app.inject({ url: '/v1/plataforma/auth/eu', cookies: cfg })).json()).toMatchObject({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
    // a sessão comum (senha antiga) com a troca pendente não tem o motivo
    const comum = await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE);
    const semAtual = await m.app.inject({ method: 'POST', url: '/v1/plataforma/auth/senha', headers: csrf, cookies: { [COOKIE_CONFIG]: cookie(comum, COOKIE_CONFIG)! }, payload: { senha_nova: SENHA_NOVA } });
    expect(semAtual.statusCode).toBe(400);
    expect(semAtual.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { senha_atual: expect.any(String) } });
    // a sessão comum com a troca pendente é a provisória no bloqueio
    expect((await m.app.inject({ url: ROTA_PORTAL, cookies: { [COOKIE_CONFIG]: cookie(comum, COOKIE_CONFIG)! } })).json()).toMatchObject({ motivo: 'provisoria' });
    const troca = await m.app.inject({ method: 'POST', url: '/v1/plataforma/auth/senha', headers: csrf, cookies: cfg, payload: { senha_nova: SENHA_NOVA } });
    expect(troca.statusCode).toBe(204);
    expect(m.plataforma.chamadas).toContain('superadmin_trocar_senha');
    expect(m.sa.deve_trocar_senha).toBe(false);
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_NOVA)).statusCode).toBe(200);
  });

  it('superadmin: temporária vencida e temporária errada contam na trava; corrida perdida = 401 sem sessão', async () => {
    const m = await montar();
    await comTemporaria(m.sa, 60_000);
    m.relogio.avancar(60_000);
    expect((await login(m, 'MACUXI', EMAIL_SA, TEMPORARIA)).statusCode).toBe(401);
    expect(m.sa.falhas_login).toBe(1);
    expect(m.plataforma.chamadas).not.toContain('superadmin_consumir_temporaria');
    for (let i = 0; i < 4; i++) await login(m, 'MACUXI', EMAIL_SA, 'Temp-errada-9!');
    expect(m.sa.bloqueado_ate).not.toBeNull();
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE)).statusCode).toBe(401);

    const c = await montar();
    await comTemporaria(c.sa);
    c.plataforma.perderCorrida = true;
    const r = await login(c, 'MACUXI', EMAIL_SA, TEMPORARIA);
    expect(r.body).toBe(JSON.stringify(NEUTRO_401));
    expect(c.plataforma.sessoes).toHaveLength(0);
    expect(c.sa.falhas_login).toBe(0);
  });

  it('esqueci com MACUXI: o mesmo 202, grava pela superadmin_emitir_temporaria (id, hash, 72 h) e envia depois da resposta', async () => {
    const m = await montar();
    const existe = await esqueci(m, 'macuxi', EMAIL_SA);
    expect(m.envio.enviados).toHaveLength(0);
    await esperarSegundoPlano(m);
    const naoExiste = await esqueci(m, 'MACUXI', 'ninguem@exemplo.com', '203.0.113.8');
    const inativo = await esqueci(m, 'MACUXI', 'antigo@exemplo.com', '203.0.113.9');
    const tenant = await esqueci(m, 'AM2808', 'ninguem@exemplo.com', '203.0.113.10');
    for (const r of [existe, naoExiste, inativo]) {
      expect(r.statusCode).toBe(202);
      expect(r.body).toBe(tenant.body);
    }
    await esperarSegundoPlano(m);
    expect(m.envio.enviados.map((e) => [e.para, e.depoisDaResposta])).toEqual([[EMAIL_SA, true]]);
    expect(m.plataforma.chamadas.filter((f) => f === 'superadmin_emitir_temporaria')).toHaveLength(1);
    expect(m.sa.senha_temporaria_expira_em!.getTime() - INICIO.getTime()).toBe(H72);
    const temporaria = /Senha temporária: (\S+)/.exec(m.envio.enviados[0]!.texto)![1]!;
    expect((await login(m, 'MACUXI', EMAIL_SA, temporaria)).statusCode).toBe(200);
    expect(m.sa.deve_trocar_senha).toBe(true);
  });

  it('o limite da conta MACUXI é o mesmo do /config (plataforma + e-mail): 2 pela tela única + 1 pelo /config, o 4º é 429', async () => {
    const m = await montar();
    expect((await esqueci(m, 'MACUXI', EMAIL_SA, '198.51.100.1')).statusCode).toBe(202);
    expect((await esqueci(m, 'MACUXI', EMAIL_SA, '198.51.100.2')).statusCode).toBe(202);
    expect((await esqueciConfig(m, EMAIL_SA, '198.51.100.3')).statusCode).toBe(202);
    await esperarSegundoPlano(m);
    const chamadas = m.plataforma.chamadas.length;
    const r = await esqueciConfig(m, ` ${EMAIL_SA.toUpperCase()}`, '198.51.100.4');
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS', detalhes: { retry_after_s: 3600 } });
    expect((await esqueci(m, 'MACUXI', EMAIL_SA, '198.51.100.5')).body).toBe(r.body);
    await esperarSegundoPlano(m);
    expect(m.plataforma.chamadas).toHaveLength(chamadas);
  });

  it('POST /v1/plataforma/auth/esqueci exige o anti-CSRF e responde o mesmo 202 neutro', async () => {
    const m = await montar();
    expect((await m.app.inject({ method: 'POST', url: '/v1/plataforma/auth/esqueci', payload: { email: EMAIL_SA } })).statusCode).toBe(403);
    expect((await m.app.inject({ method: 'POST', url: '/v1/plataforma/auth/esqueci', headers: csrf, payload: { email: 'x' } })).statusCode).toBe(400);
    const r = await esqueciConfig(m, EMAIL_SA);
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
  });
});

describe('T-0083: login certo cancela a temporária, e-mail da conta, CSRF e tempo constante no esqueci', () => {
  it('superadmin: o login certo com a senha atual e a temporária pendente chama a superadmin_cancelar_temporaria; a temporária não vale mais', async () => {
    const m = await montar();
    await comTemporaria(m.sa);
    const r = await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE);
    expect(r.statusCode).toBe(200);
    expect(m.plataforma.chamadas.filter((f) => f === 'superadmin_cancelar_temporaria')).toHaveLength(1);
    expect(m.sa).toMatchObject({ senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: false });
    expect((await login(m, 'MACUXI', EMAIL_SA, TEMPORARIA)).body).toBe(JSON.stringify(NEUTRO_401));
    // sem temporária pendente, nem senha errada, a função não é chamada
    expect((await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE)).statusCode).toBe(200);
    await comTemporaria(m.sa);
    expect((await login(m, 'MACUXI', EMAIL_SA, 'errada-1')).statusCode).toBe(401);
    expect(m.plataforma.chamadas.filter((f) => f === 'superadmin_cancelar_temporaria')).toHaveLength(1);
    expect(m.sa.senha_temporaria_hash).toBeTruthy();
  });

  it('o "para" do e-mail é o endereço da conta lido do banco, não o digitado (tenant e MACUXI)', async () => {
    const m = await montar();
    m.adm.email = 'Adm.Conta@Exemplo.com';
    m.sa.email = 'SuperAdmin@Exemplo.com';
    expect((await esqueci(m, 'AM2808', ' ADM.CONTA@exemplo.COM ')).statusCode).toBe(202);
    expect((await esqueci(m, 'MACUXI', 'superadmin@exemplo.com', '203.0.113.8')).statusCode).toBe(202);
    await esperarSegundoPlano(m);
    expect(m.envio.enviados.map((e) => e.para).sort()).toEqual(['Adm.Conta@Exemplo.com', 'SuperAdmin@Exemplo.com']);
  });

  it('MACUXI sem o CABECALHO_CSRF_CONFIG: o mesmo 401 do login, sem banco, sem argon2, sem gastar a cota da conta; o tenant não exige o cabeçalho', async () => {
    const m = await montar();
    const doLogin = await login(m, 'MACUXI', EMAIL_SA, SENHA_DE_TESTE, '203.0.113.20', {});
    hashes.mockClear();
    const sem = await esqueci(m, 'MACUXI', EMAIL_SA, '203.0.113.21', {});
    const errado = await esqueci(m, 'macuxi', EMAIL_SA, '203.0.113.22', { [CABECALHO_CSRF_CONFIG]: '0' });
    for (const r of [sem, errado]) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toBe(doLogin.body);
      expect(r.body).toBe(JSON.stringify({ codigo: 'NAO_AUTENTICADO', mensagem: MENSAGEM_FALHA_LOGIN }));
    }
    await esperarSegundoPlano(m);
    expect(m.plataforma.chamadas).toEqual([]);
    expect(hashes).not.toHaveBeenCalled();
    expect(m.envio.enviados).toEqual([]);
    // a cota da conta (3 por hora) segue inteira
    for (let i = 0; i < 3; i++) expect((await esqueci(m, 'MACUXI', EMAIL_SA, `203.0.113.${30 + i}`)).statusCode).toBe(202);
    expect((await esqueci(m, 'AM2808', 'adm@exemplo.com', '203.0.113.40', {})).statusCode).toBe(202);
    await esperarSegundoPlano(m);
  });

  it('o caminho da resposta não consulta o banco: cada consulta do pedido vem depois do 202, e com o banco parado a resposta sai igual', async () => {
    const m = await montar();
    let naResposta = false;
    const consultas: boolean[] = [];
    let abrir: () => void = () => {};
    let portao: Promise<void> = Promise.resolve();
    const semTenant = m.banco.semTenant.bind(m.banco);
    m.banco.semTenant = async (fn) => (consultas.push(naResposta), await portao, semTenant(fn));
    const antesDaSessao = m.plataforma.antesDaSessao.bind(m.plataforma);
    m.plataforma.antesDaSessao = async (fn) => (consultas.push(naResposta), await portao, antesDaSessao(fn));
    const pedir = async (empresa: string, email: string, ip: string) => {
      naResposta = true;
      const r = await esqueci(m, empresa, email, ip);
      naResposta = false;
      return r;
    };
    const casos = [['AM2808', 'adm@exemplo.com'], ['AM2808', 'ninguem@exemplo.com'], ['SP9999', 'adm@exemplo.com'], ['MACUXI', EMAIL_SA], ['MACUXI', 'ninguem@exemplo.com']] as const;
    const rs = [];
    for (const [i, [empresa, email]] of casos.entries()) {
      rs.push(await pedir(empresa, email, `198.51.100.${60 + i}`));
      await esperarSegundoPlano(m);
    }
    for (const r of rs) {
      expect(r.statusCode).toBe(202);
      expect(r.body).toBe(rs[0]!.body);
    }
    expect(consultas.length).toBeGreaterThanOrEqual(casos.length);
    expect(consultas.every((durante) => !durante)).toBe(true);
    expect(m.envio.enviados.map((e) => e.para).sort()).toEqual(['adm@exemplo.com', EMAIL_SA]);

    // banco parado: a resposta não espera por ele; o pedido termina quando o banco volta
    portao = new Promise<void>((r) => (abrir = r));
    const parado = await Promise.race([
      pedir('AM2808', 'adm@exemplo.com', '198.51.100.70'),
      new Promise<'esperou o banco'>((r) => setTimeout(() => r('esperou o banco'), 2000)),
    ]);
    expect(parado).toMatchObject({ statusCode: 202, body: rs[0]!.body });
    expect(m.envio.enviados).toHaveLength(2);
    abrir();
    await esperarSegundoPlano(m);
    expect(m.envio.enviados).toHaveLength(3);
  });

  it('erro no segundo plano: o 202 já saiu e o log leva só um id, sem e-mail nem mensagem do erro', async () => {
    const m = await montar();
    m.repo.tenantIdPorSlug = async () => {
      throw new Error('falhou para adm@exemplo.com');
    };
    const r = await esqueci(m, 'AM2808', 'adm@exemplo.com');
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
    await esperarSegundoPlano(m);
    const linha = m.logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === 'esqueci.falha');
    expect(linha).toMatchObject({ level: 50, erro_id: expect.stringMatching(/^[0-9a-f-]{36}$/), request_id: expect.any(String) });
    expect(m.logs.join('\n')).not.toMatch(/exemplo\.com|falhou para/);
    expect(m.envio.enviados).toEqual([]);
  });
});
