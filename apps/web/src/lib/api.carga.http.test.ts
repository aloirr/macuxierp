import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15000 });
async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  return import('./api');
}
const resposta = (status: number, corpo: unknown) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
const form = () => new FormData();

describe('enviarCarga: erros da API (T-0051)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('400 usa o texto de campos.arquivos', async () => {
    vi.stubGlobal('fetch', resposta(400, { codigo: 'VALIDACAO', mensagem: 'Corpo inválido', campos: { arquivos: 'Envie só o arquivo preco.csv neste botão.' } }));
    const { enviarCarga } = await carregar();
    expect(await enviarCarga('T', form())).toEqual({ ok: false, erro: 'Envie só o arquivo preco.csv neste botão.' });
  });
  it('400 sem campos.arquivos cai na mensagem; sem nada, no texto padrão', async () => {
    vi.stubGlobal('fetch', resposta(400, { codigo: 'VALIDACAO', mensagem: 'Modo inválido' }));
    expect(await (await carregar()).enviarCarga('T', form())).toEqual({ ok: false, erro: 'Modo inválido' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 400 })));
    expect((await (await carregar()).enviarCarga('T', form()))).toEqual({ ok: false, erro: 'Envio inválido: confira os arquivos e o modo.' });
  });
  it('413 e 503 TEMPO_ESGOTADO têm mensagem própria; outro 503 , a genérica', async () => {
    vi.stubGlobal('fetch', resposta(413, { codigo: 'ARQUIVO_GRANDE' }));
    expect((await (await carregar()).enviarCarga('T', form())).ok).toBe(false);
    expect(((await (await carregar()).enviarCarga('T', form())) as { erro: string }).erro).toContain('10 MB');
    vi.stubGlobal('fetch', resposta(503, { codigo: 'TEMPO_ESGOTADO', mensagem: 'A operação passou de 30 s' }));
    expect(((await (await carregar()).enviarCarga('T', form())) as { erro: string }).erro).toContain('A carga passou do tempo');
    vi.stubGlobal('fetch', resposta(503, { codigo: 'INDISPONIVEL' }));
    expect(((await (await carregar()).enviarCarga('T', form())) as { erro: string }).erro).toContain('não pôde ser concluída');
  });
});

describe('timeout das chamadas', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('enviarCarga usa 130 s; as demais chamadas, 10 s', async () => {
    const t = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', resposta(200, {}));
    const api = await carregar();
    await api.enviarCarga('T', form());
    expect(t).toHaveBeenLastCalledWith(130_000);
    await api.buscarEu('T').catch(() => undefined);
    expect(t).toHaveBeenLastCalledWith(10_000);
  });
});
