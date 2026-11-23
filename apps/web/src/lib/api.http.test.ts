import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Estoura 5 s sob a carga do turbo (T-0021).
vi.setConfig({ testTimeout: 15000 });

async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  return import('./api');
}
const resposta = (status: number, corpo: unknown) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));

describe('entrar com a API simulada (fetch)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('429 leva a mensagem devolvida pela API', async () => {
    vi.stubGlobal('fetch', resposta(429, { codigo: 'LIMITE', mensagem: 'Aguarde 7 minutos.' }));
    const { entrar, MuitasTentativas } = await carregar();
    const e = await entrar('demo', 'a@exemplo.invalid', 'x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MuitasTentativas);
    expect((e as Error).message).toBe('Aguarde 7 minutos.');
  });
  it('429 sem corpo utilizável fica com mensagem vazia (a tela usa o texto padrão)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nao-json', { status: 429 })));
    const { entrar } = await carregar();
    const e = await entrar('demo', 'a@exemplo.invalid', 'x').catch((x: unknown) => x);
    expect((e as Error).message).toBe('');
  });
  it('400 vira DadosInvalidos', async () => {
    vi.stubGlobal('fetch', resposta(400, { codigo: 'VALIDACAO' }));
    const { entrar, DadosInvalidos } = await carregar();
    await expect(entrar('demo', 'a@exemplo.invalid', 'x')).rejects.toBeInstanceOf(DadosInvalidos);
  });
});

describe('BFF: prova e IP do cliente (T-0050)', () => {
  const SEGREDO = 'segredo-de-teste-bff';
  let cabecalhosDoPedido: Headers | null;
  let enviados: Record<string, string>[];

  async function carregarBff(segredo: string | undefined) {
    vi.resetModules();
    vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
    vi.stubEnv('MACUXIERP_SEGREDO_BFF', segredo ?? '');
    vi.doMock('next/headers', () => ({
      headers: async () => {
        if (!cabecalhosDoPedido) throw new Error('fora de um pedido');
        return cabecalhosDoPedido;
      },
    }));
    vi.stubGlobal('fetch', async (_u: string, init: { headers: Record<string, string> }) => {
      enviados.push(init.headers);
      return new Response('{}');
    });
    return import('./api');
  }
  beforeEach(() => {
    enviados = [];
    cabecalhosDoPedido = new Headers({ 'cf-connecting-ip': '203.0.113.9' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('next/headers');
  });

  it('manda a prova com o segredo e o IP do cf-connecting-ip', async () => {
    const { buscarNaApi } = await carregarBff(SEGREDO);
    await buscarNaApi('/v1/x', { headers: { authorization: 'Bearer t' } });
    expect(enviados[0]).toMatchObject({ authorization: 'Bearer t', 'x-macuxierp-bff': SEGREDO, 'x-macuxierp-ip-cliente': '203.0.113.9' });
  });
  it('aceita IPv6', async () => {
    cabecalhosDoPedido = new Headers({ 'cf-connecting-ip': '2001:db8::1' });
    const { buscarNaApi } = await carregarBff(SEGREDO);
    await buscarNaApi('/v1/x', {});
    expect(enviados[0]?.['x-macuxierp-ip-cliente']).toBe('2001:db8::1');
  });
  it('IP inválido ou ausente é omitido', async () => {
    const { buscarNaApi } = await carregarBff(SEGREDO);
    cabecalhosDoPedido = new Headers({ 'cf-connecting-ip': 'nao-e-ip' });
    await buscarNaApi('/v1/x', {});
    cabecalhosDoPedido = new Headers();
    await buscarNaApi('/v1/x', {});
    expect(enviados.map((h) => h['x-macuxierp-ip-cliente'])).toEqual([undefined, undefined]);
    expect(enviados[0]?.['x-macuxierp-bff']).toBe(SEGREDO);
  });
  it('segredo ausente ou vazio: sem prova', async () => {
    const { buscarNaApi } = await carregarBff(undefined);
    await buscarNaApi('/v1/x', {});
    expect(enviados[0]).not.toHaveProperty('x-macuxierp-bff');
  });
  it('fora de um pedido (headers() lança): segue sem o IP', async () => {
    cabecalhosDoPedido = null;
    const { buscarNaApi } = await carregarBff(SEGREDO);
    await buscarNaApi('/v1/x', {});
    expect(enviados[0]).toEqual({ 'x-macuxierp-bff': SEGREDO });
  });
  it('x-macuxierp-* forjado no init é descartado ou sobrescrito; o CSRF do portal segue', async () => {
    const { buscarNaApi } = await carregarBff(SEGREDO);
    await buscarNaApi('/v1/x', { headers: { 'X-Macuxierp-Bff': 'forjado', 'x-macuxierp-ip-cliente': '6.6.6.6', 'x-macuxierp-outro': 'y', 'x-macuxierp-config': '1' } });
    expect(enviados[0]).toEqual({ 'x-macuxierp-config': '1', 'x-macuxierp-bff': SEGREDO, 'x-macuxierp-ip-cliente': '203.0.113.9' });
  });
  it('o login do BKO leva os dois', async () => {
    const { entrar } = await carregarBff(SEGREDO);
    await entrar('demo', 'a@exemplo.invalid', 'x').catch(() => undefined);
    expect(enviados[0]).toMatchObject({ 'x-macuxierp-bff': SEGREDO, 'x-macuxierp-ip-cliente': '203.0.113.9' });
  });
});
