import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Estoura 5 s sob a carga do turbo (T-0021).
vi.setConfig({ testTimeout: 15000 });

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const Item = z.object({ id: z.string().uuid(), nome: z.string() });

async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  const [l, u, a] = await Promise.all([import('./listas'), import('./listas-url'), import('./api')]);
  return { ...l, ...u, ...a };
}
const resposta = (status: number, corpo: unknown) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buscarPagina', () => {
  it('aceita a página do contrato e chama a API com a mesma query', async () => {
    const f = resposta(200, { itens: [{ id: ID1, nome: 'A' }], proximo_cursor: ID2 });
    vi.stubGlobal('fetch', f);
    const { buscarPagina, urlProxima } = await carregar();
    const filtros = { busca: 'a' };
    const p = await buscarPagina('/v1/core/usuarios', filtros, Item, 'tok');
    expect(p.itens).toHaveLength(1);
    expect(urlProxima('/core/usuarios', filtros, p.proximo_cursor)).toBe(`/core/usuarios?busca=a&cursor=${ID2}`);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.exemplo.invalid/v1/core/usuarios?busca=a');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
  it('rejeita o formato antigo com pagina/total', async () => {
    vi.stubGlobal('fetch', resposta(200, { itens: [], pagina: 1, total: 0 }));
    const { buscarPagina, ApiIndisponivel } = await carregar();
    const e = await buscarPagina('/v1/x', {}, Item, 't').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiIndisponivel);
    expect((e as Error).message).toBe('lista fora do contrato');
  });
  it('sem API configurada fora de produção devolve a página vazia', async () => {
    vi.resetModules();
    vi.stubEnv('MACUXIERP_API_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { buscarPagina } = await import('./listas');
    expect(await buscarPagina('/v1/x', {}, Item, 't')).toEqual({ itens: [], proximo_cursor: null });
    expect(f).not.toHaveBeenCalled();
  });
  it('401 vira NaoAutenticado', async () => {
    vi.stubGlobal('fetch', resposta(401, {}));
    const { buscarPagina, NaoAutenticado } = await carregar();
    await expect(buscarPagina('/v1/x', {}, Item, 't')).rejects.toBeInstanceOf(NaoAutenticado);
  });
  it('403 vira SemPermissao', async () => {
    vi.stubGlobal('fetch', resposta(403, {}));
    const { buscarPagina, SemPermissao } = await carregar();
    await expect(buscarPagina('/v1/x', {}, Item, 't')).rejects.toBeInstanceOf(SemPermissao);
  });
  it('400 vira DadosInvalidos', async () => {
    vi.stubGlobal('fetch', resposta(400, {}));
    const { buscarPagina, DadosInvalidos } = await carregar();
    const e = await buscarPagina('/v1/x', {}, Item, 't').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DadosInvalidos);
    expect((e as Error).message).toBe('lista: VALIDACAO');
  });
  it('500 vira ApiIndisponivel', async () => {
    vi.stubGlobal('fetch', resposta(500, {}));
    const { buscarPagina, ApiIndisponivel } = await carregar();
    await expect(buscarPagina('/v1/x', {}, Item, 't')).rejects.toBeInstanceOf(ApiIndisponivel);
  });
  it('JSON quebrado vira ApiIndisponivel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{quebrado', { status: 200 })));
    const { buscarPagina, ApiIndisponivel } = await carregar();
    await expect(buscarPagina('/v1/x', {}, Item, 't')).rejects.toBeInstanceOf(ApiIndisponivel);
  });
  it('item fora do schema vira ApiIndisponivel', async () => {
    vi.stubGlobal('fetch', resposta(200, { itens: [{ id: 'nao-uuid', nome: 1 }], proximo_cursor: null }));
    const { buscarPagina, ApiIndisponivel } = await carregar();
    await expect(buscarPagina('/v1/x', {}, Item, 't')).rejects.toBeInstanceOf(ApiIndisponivel);
  });
  it('caminho fora do padrão /v1/... é rejeitado sem chamar a API', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { buscarPagina } = await carregar();
    for (const c of ['/core/x', 'https://x.invalid/v1/a', '/v1/A', '/v1/a?x=1', '/v1/']) {
      await expect(buscarPagina(c, {}, Item, 't')).rejects.toThrow('buscarPagina: caminho da API inválido');
    }
    expect(f).not.toHaveBeenCalled();
  });
});
