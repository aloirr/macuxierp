/**
 * T-0133 (v0.3.30), ADR 0021: o `ServicoAuth` com o login e o "esqueci" só por e-mail, sem o código da empresa. A conta
 * sai do `contaPorEmail` (no banco, a `plataforma.conta_por_email` da 0079; aqui, o `RepositorioAuthMemoria`, que imita a
 * ordem da função: usuário de empresa primeiro, superadmin só sem usuário). O caminho no PostgreSQL fica no
 * `login-email.db.test.ts`; a rota, no `app.test.ts` e no `esqueci-senha.test.ts`.
 */
import {
  CODIGO_CONTA_BLOQUEADA,
  CODIGO_EMPRESA_SUSPENSA,
  ErroApi,
  MENSAGEM_EMPRESA_SUSPENSA,
  MENSAGEM_LOGIN_INVALIDO,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { BancoMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE, SENHA_DE_TESTE } from '../apoio-teste';
import { CONFERENCIAS_POR_RECUSA } from './apoio-login';
import { RepositorioAuthMemoria } from './repositorio-memoria';
import { contaDaLinha } from './repositorio-pg';
import * as senha from './senha';
import { CONFIG_AUTH_PADRAO, DESVIO_SUPERADMIN, ServicoAuth, type ResultadoLogin } from './servico';

vi.mock('./senha', async (original) => {
  const m = await original<typeof import('./senha')>();
  return { ...m, conferirSenha: vi.fn(m.conferirSenha), gerarHashSenha: vi.fn(m.gerarHashSenha) };
});
const conferencias = vi.mocked(senha.conferirSenha);
const hashes = vi.mocked(senha.gerarHashSenha);

const ATIVA = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const SUSPENSA = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const ENCERRADA = '8b2f3e4d-5c6b-4a7f-9e8d-0c1b2a3f4e5d';
const ADM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const DO_SUSPENSO = '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e';
const DO_ENCERRADO = '4c5d6e7f-8a9b-4c0d-9e1f-3a4b5c6d7e8f';
const DUPLO = '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a';
const INICIO = new Date('2026-11-28T15:00:00Z');
const TEMPORARIA = 'Temp-Abc23xyz!Q';

async function montar() {
  const relogio = new RelogioFixo(INICIO);
  const hash = await senha.gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO);
  const repo = new RepositorioAuthMemoria(() => relogio.agora());
  repo.tenants.push(
    { id: ATIVA, slug: 'am2808', razao_social: 'Ativa Ltda', fuso: 'America/Manaus', situacao: 'ativo' },
    { id: SUSPENSA, slug: 'am1234', razao_social: 'Suspensa Ltda', fuso: 'America/Manaus', situacao: 'suspenso' },
    { id: ENCERRADA, slug: 'am4321', razao_social: 'Encerrada Ltda', fuso: 'America/Manaus', situacao: 'encerrado' },
  );
  const base = { nome: 'Pessoa', senha_hash: hash, perfil: 'administrador' as const, filial_ids: [], ativo: true, falhas_login: 0, bloqueado_ate: null, deve_trocar_senha: false };
  repo.usuarios.push(
    { ...base, id: ADM, tenant_id: ATIVA, email: 'adm@exemplo.com' },
    { ...base, id: DO_SUSPENSO, tenant_id: SUSPENSA, email: 'susp@exemplo.com' },
    { ...base, id: DO_ENCERRADO, tenant_id: ENCERRADA, email: 'enc@exemplo.com' },
    // ADR 0021 §7 (opção A): o mesmo e-mail num usuário de empresa e num superadmin
    { ...base, id: DUPLO, tenant_id: ATIVA, email: 'duplo@exemplo.com' },
  );
  repo.superadmins.push('sa@exemplo.com', 'duplo@exemplo.com');
  const banco = new BancoMemoria();
  const servico = new ServicoAuth(banco, repo, { ...CONFIG_AUTH_PADRAO, jwtSegredo: JWT_SEGREDO_DE_TESTE, argon2: ARGON2_RAPIDO }, relogio);
  const usuario = (id: string) => repo.usuarios.find((u) => u.id === id)!;
  return { servico, repo, banco, relogio, usuario };
}

/** A recusa lançada pelo serviço (o `ErroApi`), com o número de conferências de argon2 que ela custou. */
async function recusa(p: Promise<unknown>): Promise<{ status: number; codigo: string; mensagem: string; argon2: number }> {
  conferencias.mockClear();
  try {
    await p;
  } catch (e) {
    if (!(e instanceof ErroApi)) throw e;
    return { status: e.status, codigo: e.codigo, mensagem: e.message, argon2: conferencias.mock.calls.length };
  }
  throw new Error('esperava uma recusa');
}

const NEUTRO = { status: 401, codigo: 'NAO_AUTENTICADO', mensagem: MENSAGEM_LOGIN_INVALIDO, argon2: CONFERENCIAS_POR_RECUSA };

beforeEach(() => {
  conferencias.mockClear();
  hashes.mockClear();
});

describe('ADR 0021 §2 e §3: login só por e-mail', () => {
  it('e-mail de usuário de empresa ativa: sessão do BKO no tenant dele, sem informar empresa', async () => {
    const { servico } = await montar();
    const r = (await servico.entrar({ email: ' ADM@Exemplo.com ', senha: SENHA_DE_TESTE })) as ResultadoLogin;
    expect(r).not.toBe(DESVIO_SUPERADMIN);
    expect(r.tenant_id).toBe(ATIVA);
    expect(r.refresh.startsWith(`${ATIVA}.`)).toBe(true);
  });

  it('e-mail inexistente e senha errada: o mesmo 401 com o texto do SDK e o mesmo custo de argon2 (ConferenciaCustoIgual)', async () => {
    const { servico, usuario } = await montar();
    const inexistente = await recusa(servico.entrar({ email: 'ninguem@exemplo.com', senha: SENHA_DE_TESTE }));
    const errada = await recusa(servico.entrar({ email: 'adm@exemplo.com', senha: 'errada' }));
    expect(inexistente).toEqual(NEUTRO);
    expect(errada).toEqual(NEUTRO);
    expect(usuario(ADM).falhas_login).toBe(1);
  });

  it('empresa encerrada = e-mail inexistente: o mesmo 401 e custo, sem tocar a conta', async () => {
    const { servico, usuario, banco } = await montar();
    const antes = banco.aberturas.length;
    expect(await recusa(servico.entrar({ email: 'enc@exemplo.com', senha: SENHA_DE_TESTE }))).toEqual(NEUTRO);
    // só a transação sem tenant da conta_por_email; nenhuma no tenant encerrado
    expect(banco.aberturas.slice(antes)).toEqual([null]);
    expect(usuario(DO_ENCERRADO).falhas_login).toBe(0);
  });

  it('empresa suspensa (decisão do PO): senha errada = o 401 genérico; senha certa = 403 EMPRESA_SUSPENSA, sem sessão, com o mesmo custo', async () => {
    const { servico, repo, usuario } = await montar();
    expect(await recusa(servico.entrar({ email: 'susp@exemplo.com', senha: 'errada' }))).toEqual(NEUTRO);
    expect(usuario(DO_SUSPENSO).falhas_login).toBe(1);
    const certa = await recusa(servico.entrar({ email: 'susp@exemplo.com', senha: SENHA_DE_TESTE }));
    expect(certa).toEqual({ status: 403, codigo: CODIGO_EMPRESA_SUSPENSA, mensagem: MENSAGEM_EMPRESA_SUSPENSA, argon2: CONFERENCIAS_POR_RECUSA });
    expect(MENSAGEM_EMPRESA_SUSPENSA).toBe('Sua empresa está suspensa. Fale com o administrador da Macuxi.');
    expect(repo.sessoes).toEqual([]);
    // a senha certa não zera a contagem: nada muda na conta da empresa suspensa
    expect(usuario(DO_SUSPENSO).falhas_login).toBe(1);
  });

  it('empresa suspensa com a temporária vigente: 403 sem consumir a temporária nem abrir sessão', async () => {
    const { servico, repo, usuario } = await montar();
    const u = usuario(DO_SUSPENSO);
    u.senha_temporaria_hash = await senha.gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
    u.senha_temporaria_expira_em = new Date(INICIO.getTime() + 3_600_000);
    expect(await recusa(servico.entrar({ email: 'susp@exemplo.com', senha: TEMPORARIA }))).toMatchObject({ status: 403, codigo: CODIGO_EMPRESA_SUSPENSA });
    expect(u.senha_temporaria_hash).not.toBeNull();
    expect(u.deve_trocar_senha).toBe(false);
    expect(repo.sessoes).toEqual([]);
  });

  it('a recusa da empresa suspensa só vem depois da trava: conta travada dá o 423 de sempre', async () => {
    const { servico, usuario } = await montar();
    usuario(DO_SUSPENSO).bloqueado_ate = new Date('9999-12-31T00:00:00Z');
    expect(await recusa(servico.entrar({ email: 'susp@exemplo.com', senha: SENHA_DE_TESTE }))).toMatchObject({ status: 423, codigo: CODIGO_CONTA_BLOQUEADA });
  });
});

describe('ADR 0021 §4: trava por e-mail (chaveEmail) e o limite por IP', () => {
  it('o e-mail inexistente trava na memória depois de maxFalhas, em qualquer caixa ou com espaços; outro e-mail não', async () => {
    const { servico } = await montar();
    for (let i = 0; i < CONFIG_AUTH_PADRAO.maxFalhas; i++) expect((await recusa(servico.entrar({ email: 'ninguem@exemplo.com', senha: 'x' }))).status).toBe(401);
    const travado = await recusa(servico.entrar({ email: ' NINGUEM@exemplo.COM ', senha: 'x' }));
    expect(travado).toMatchObject({ status: 423, codigo: CODIGO_CONTA_BLOQUEADA, argon2: CONFERENCIAS_POR_RECUSA });
    expect((await recusa(servico.entrar({ email: 'outro@exemplo.com', senha: 'x' }))).status).toBe(401);
  });

  it('a conta que existe trava pelo banco depois de maxFalhas (o mesmo 423)', async () => {
    const { servico } = await montar();
    for (let i = 0; i < CONFIG_AUTH_PADRAO.maxFalhas; i++) await recusa(servico.entrar({ email: 'adm@exemplo.com', senha: 'errada' }));
    expect(await recusa(servico.entrar({ email: 'adm@exemplo.com', senha: SENHA_DE_TESTE }))).toMatchObject({ status: 423, codigo: CODIGO_CONTA_BLOQUEADA });
  });

  it('com o IP no limite, o e-mail inexistente recebe o 429 do limite, sem contar na trava', async () => {
    const { servico } = await montar();
    const limite = () => new ErroApi(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas');
    for (let i = 0; i < CONFIG_AUTH_PADRAO.maxFalhas + 1; i++) expect((await recusa(servico.entrar({ email: 'ninguem@exemplo.com', senha: 'x' }, limite))).status).toBe(429);
    expect((await recusa(servico.entrar({ email: 'ninguem@exemplo.com', senha: 'x' }))).status).toBe(401);
  });
});

describe('ADR 0021 §5 e §7 (opção A): superadmin na mesma tela', () => {
  it('e-mail só de superadmin: DESVIO_SUPERADMIN, sem argon2 nem transação de tenant (a rota segue pelo ServicoPlataforma)', async () => {
    const { servico, banco } = await montar();
    const antes = banco.aberturas.length;
    expect(await servico.entrar({ email: 'SA@exemplo.com', senha: 'qualquer' })).toBe(DESVIO_SUPERADMIN);
    expect(conferencias).not.toHaveBeenCalled();
    expect(banco.aberturas.slice(antes)).toEqual([null]);
  });

  it('mesmo e-mail no usuário e no superadmin: sempre o BKO, com a senha do usuário; a senha do superadmin é o 401 genérico', async () => {
    const { servico, usuario } = await montar();
    const bko = (await servico.entrar({ email: 'duplo@exemplo.com', senha: SENHA_DE_TESTE })) as ResultadoLogin;
    expect(bko).not.toBe(DESVIO_SUPERADMIN);
    expect(bko.tenant_id).toBe(ATIVA);
    expect(await recusa(servico.entrar({ email: 'duplo@exemplo.com', senha: 'senha-do-superadmin-1' }))).toEqual(NEUTRO);
    expect(usuario(DUPLO).falhas_login).toBe(1);
  });
});

describe('ADR 0021 §4: esqueci só por e-mail', () => {
  const repoCore = (repo: RepositorioAuthMemoria) => ({
    async emitirSenhaTemporaria(tx: Transacao, usuarioId: string, hash: string, expiraEm: Date) {
      const u = repo.usuarios.find((x) => x.id === usuarioId && x.tenant_id === tenantDaTx(tx));
      if (!u) throw new Error('usuário fora do tenant');
      Object.assign(u, { senha_temporaria_hash: hash, senha_temporaria_expira_em: expiraEm });
    },
  });

  it('só a conta ativa recebe; inexistente, encerrada e suspensa: nada; o argon2 da temporária roda em todas', async () => {
    const { servico, repo } = await montar();
    const gravados: string[] = [];
    const resultados = [];
    for (const email of ['adm@exemplo.com', 'ninguem@exemplo.com', 'enc@exemplo.com', 'susp@exemplo.com']) {
      hashes.mockClear();
      resultados.push(await servico.esqueci({ email }, repoCore(repo), async (_tx, c) => void gravados.push(c.usuario_id)));
      expect(hashes, email).toHaveBeenCalledTimes(1);
    }
    const [ativa, ...nada] = resultados;
    expect(nada).toEqual([null, null, null]);
    expect(ativa).toMatchObject({ para: 'adm@exemplo.com' });
    expect(gravados).toEqual([ADM]);
    // §6: o e-mail da temporária não leva mais o código da empresa
    const m = ativa as { texto: string; html: string };
    for (const parte of [m.texto, m.html]) expect(parte).not.toMatch(/Código da empresa|AM2808/i);
  });

  it('mesmo e-mail no usuário e no superadmin: a temporária vai ao usuário (opção A); só superadmin = DESVIO_SUPERADMIN, sem argon2 aqui', async () => {
    const { servico, repo, usuario } = await montar();
    const r = await servico.esqueci({ email: 'duplo@exemplo.com' }, repoCore(repo), async () => {});
    expect(r).toMatchObject({ para: 'duplo@exemplo.com' });
    expect(usuario(DUPLO).senha_temporaria_hash).toMatch(/^\$argon2id\$/);
    hashes.mockClear();
    expect(await servico.esqueci({ email: 'sa@exemplo.com' }, repoCore(repo), async () => {})).toBe(DESVIO_SUPERADMIN);
    expect(hashes).not.toHaveBeenCalled();
  });
});

describe('contaDaLinha: a linha da conta_por_email (0079), nos dois formatos da empresa suspensa', () => {
  it('suspensa = true ou situacao_tenant = suspensa; o resto fica ativa', () => {
    expect(contaDaLinha({ tipo: 'usuario', tenant_id: ATIVA, suspensa: false })).toEqual({ tipo: 'usuario', tenant_id: ATIVA, suspensa: false });
    expect(contaDaLinha({ tipo: 'usuario', tenant_id: ATIVA, suspensa: true })).toEqual({ tipo: 'usuario', tenant_id: ATIVA, suspensa: true });
    expect(contaDaLinha({ tipo: 'usuario', tenant_id: ATIVA, situacao_tenant: 'suspensa' })).toEqual({ tipo: 'usuario', tenant_id: ATIVA, suspensa: true });
    expect(contaDaLinha({ tipo: 'usuario', tenant_id: ATIVA, situacao_tenant: 'ativa' })).toEqual({ tipo: 'usuario', tenant_id: ATIVA, suspensa: false });
  });

  it('superadmin sem tenant; sem linha ou fora do formato = nenhuma conta (a falha neutra)', () => {
    expect(contaDaLinha({ tipo: 'superadmin', tenant_id: null, suspensa: false })).toEqual({ tipo: 'superadmin', tenant_id: null, suspensa: false });
    for (const l of [null, undefined, { tipo: 'usuario', tenant_id: null }, { tipo: 'usuario', tenant_id: '' }, { tipo: 'outro', tenant_id: ATIVA }]) expect(contaDaLinha(l)).toBeNull();
  });
});
