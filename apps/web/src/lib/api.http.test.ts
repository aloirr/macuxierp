import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
