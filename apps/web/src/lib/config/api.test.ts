import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigIndisponivel, ConfigMuitasTentativas, ConfigNaoAutenticado, ConfigSemPermissao, ErroPlataforma, mensagemDoErro } from './erros';
import { alterarSituacao, criarPrimeiroAdmin, entrarPlataforma, listarEmpresas, redefinirSenhaPrimeiroAdmin } from './api';

const ID = '11111111-1111-4111-8111-111111111111';
const chamadas: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
let resposta: () => Response;

beforeEach(() => {
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid/';
  vi.stubGlobal('fetch', async (url: string, init: never) => {
    chamadas.push({ url, init });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...extra } });

describe('cliente da plataforma', () => {
  it('login: o token sai do cookie da API e não vai ao corpo; a conta errada devolve null', async () => {
    resposta = () => json({ expira_em: '2026-11-23T20:00:00.000Z' }, 200, { 'set-cookie': 'macuxierp_config=tok123; Path=/v1/plataforma; HttpOnly' });
    expect(await entrarPlataforma({ email: 'a@b.co', senha: 'x' })).toEqual({ token: 'tok123', expira_em: '2026-11-23T20:00:00.000Z' });
    expect(chamadas[0]?.url).toBe('https://api.exemplo.invalid/v1/plataforma/auth/entrar');
    resposta = () => json({ codigo: 'NAO_AUTENTICADO' }, 401);
    expect(await entrarPlataforma({ email: 'a@b.co', senha: 'x' })).toBeNull();
  });
  it('leitura manda o cookie da plataforma e nunca um Bearer do BKO', async () => {
    resposta = () => json({ itens: [], proximo_cursor: null });
    await listarEmpresas('tok', { busca: 'acme' });
    const h = chamadas[0]!.init.headers;
    expect(chamadas[0]?.url).toContain('/v1/plataforma/empresas?busca=acme');
    expect(h.cookie).toBe('macuxierp_config=tok');
    expect(h.authorization).toBeUndefined();
    expect(h['x-macuxierp-config']).toBeUndefined();
  });
  it('escrita leva o cabeçalho anti-CSRF e a Idempotency-Key', async () => {
    resposta = () => json({ usuario_id: ID, senha_provisoria: 'a'.repeat(16) }, 201);
    await criarPrimeiroAdmin('tok', ID, { email: 'a@b.co', nome: 'Administrador' }, 'chave-1');
    await redefinirSenhaPrimeiroAdmin('tok', ID, 'chave-2');
    expect(chamadas.map((c) => [c.init.method, c.init.headers['idempotency-key'], c.init.headers['x-macuxierp-config']])).toEqual([
      ['POST', 'chave-1', '1'],
      ['POST', 'chave-2', '1'],
    ]);
    expect(chamadas[1]?.url).toMatch(/\/primeiro-admin\/senha$/);
  });
  it('id fora do formato nunca chega ao caminho', async () => {
    await expect(alterarSituacao('tok', '../x', { situacao: 'suspenso', motivo: 'abc' }, 'k')).rejects.toBeInstanceOf(ErroPlataforma);
    expect(chamadas).toHaveLength(0);
  });
  it('401, 403, 429, 5xx e rede viram erros tipados, sem corpo cru', async () => {
    const quando = async (r: () => Response) => {
      resposta = r;
      return listarEmpresas('tok').catch((e: unknown) => e);
    };
    expect(await quando(() => json({}, 401))).toBeInstanceOf(ConfigNaoAutenticado);
    expect(await quando(() => json({ codigo: 'SEM_PERMISSAO' }, 403))).toBeInstanceOf(ConfigSemPermissao);
    expect(await quando(() => json({}, 429))).toBeInstanceOf(ConfigMuitasTentativas);
    expect(await quando(() => json({ mensagem: 'segredo@x.co' }, 500))).toBeInstanceOf(ConfigIndisponivel);
    expect(await quando(() => json({ qualquer: 1 }, 200))).toBeInstanceOf(ConfigIndisponivel);
    const e = (await quando(() => json({ codigo: 'TROCAR_SENHA' }, 403))) as ErroPlataforma;
    expect(e).toMatchObject({ status: 403, codigo: 'TROCAR_SENHA' });
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await listarEmpresas('tok').catch((x: unknown) => x)).toBeInstanceOf(ConfigIndisponivel);
  });
});

describe('mensagens', () => {
  it('textos da spec por contexto', () => {
    expect(mensagemDoErro(new ErroPlataforma(409, 'CONFLITO'), 'criar_empresa').campos.slug).toBe('Já existe uma empresa com esse código. Escolha outro.');
    expect(mensagemDoErro(new ErroPlataforma(409, 'CONFLITO'), 'criar_admin').texto).toBe('Esta empresa já tem administrador. Redefina a senha dele.');
    expect(mensagemDoErro(new ErroPlataforma(409, 'CONFLITO'), 'redefinir')).toMatchObject({ texto: 'A senha já foi exibida. Redefina para gerar outra.', chaveNova: true });
    expect(mensagemDoErro(new ConfigNaoAutenticado(), 'situacao').expirou).toBe(true);
    expect(mensagemDoErro(new ConfigMuitasTentativas(), 'entrar').texto).toBe('Muitas tentativas. Aguarde 15 minutos e tente de novo.');
    expect(mensagemDoErro(new ConfigIndisponivel('x'), 'situacao')).toMatchObject({ texto: 'Não foi possível concluir. Tente de novo.', chaveNova: false });
    expect(mensagemDoErro(new ErroPlataforma(404, 'NAO_ENCONTRADO'), 'email').texto).toBe('A empresa ainda não tem 1º administrador.');
    expect(mensagemDoErro(new ErroPlataforma(404, 'NAO_ENCONTRADO'), 'carregar').texto).toBe('Empresa não encontrada. Volte à lista.');
  });
});
