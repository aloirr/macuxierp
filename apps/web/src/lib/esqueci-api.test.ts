import { CABECALHO_CSRF_CONFIG, CAMINHOS_ESQUECI_SENHA, MENSAGEM_ESQUECI_NEUTRA } from '@macuxierp/platform-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chamadas: { url: string; init: RequestInit }[] = [];
let resposta: () => Response;
async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
  return import('./esqueci-api');
}
beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return resposta(); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock('next/headers'); });
const json = (c: unknown, s: number) => new Response(JSON.stringify(c), { status: s });

describe('esqueci: chamadas à API (CAMINHOS_ESQUECI_SENHA)', () => {
  it('sempre POST /v1/auth/esqueci, com código em maiúsculas e e-mail em minúsculas, para qualquer empresa', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    resposta = () => json({ mensagem: MENSAGEM_ESQUECI_NEUTRA }, 202);
    expect(await pedirSenhaTemporaria({ empresa: ' am2808 ', email: 'A@B.co' })).toEqual({ tipo: 'ok' });
    expect(chamadas[0]?.url).toBe(`https://api.exemplo.invalid${CAMINHOS_ESQUECI_SENHA.tenant}`);
    expect(chamadas[0]?.url).not.toContain('plataforma');
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({ empresa: 'AM2808', email: 'a@b.co' });
  });
  it('o esqueci leva sempre o CSRF do SDK (sem ele o código reservado responde 401 neutro)', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    resposta = () => json({ mensagem: MENSAGEM_ESQUECI_NEUTRA }, 202);
    await pedirSenhaTemporaria({ empresa: 'AM2808', email: 'a@b.co' });
    expect(chamadas[0]?.init.headers).toMatchObject({ [CABECALHO_CSRF_CONFIG]: '1', 'content-type': 'application/json' });
  });
  it('429 com retry_after_s e 400 VALIDACAO', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    resposta = () => json({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'x', detalhes: { retry_after_s: 900 } }, 429);
    expect(await pedirSenhaTemporaria({ empresa: 'AM2808', email: 'a@b.co' })).toEqual({ tipo: 'limite', texto: 'Muitas tentativas. Tente de novo em 15 minutos.' });
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { empresa: 'Código inválido' } }, 400);
    expect(await pedirSenhaTemporaria({ empresa: 'AM2808', email: 'a@b.co' })).toEqual({ tipo: 'campos', erros: { empresa: 'Código inválido' } });
  });
  it('entrada inválida não chama a API', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    expect(await pedirSenhaTemporaria({ empresa: '', email: 'x' })).toMatchObject({ tipo: 'campos', erros: { empresa: 'Informe o código da empresa.' } });
    expect(chamadas).toHaveLength(0);
  });
  it('situação: true só com esqueci_disponivel true; falha oculta', async () => {
    const { lerSituacaoEsqueci } = await carregar();
    resposta = () => json({ esqueci_disponivel: true }, 200);
    expect(await lerSituacaoEsqueci()).toBe(true);
    expect(chamadas[0]?.url).toBe(`https://api.exemplo.invalid${CAMINHOS_ESQUECI_SENHA.situacao}`);
    resposta = () => json({ esqueci_disponivel: false }, 200);
    expect(await lerSituacaoEsqueci()).toBe(false);
    resposta = () => json({}, 500);
    expect(await lerSituacaoEsqueci()).toBe(false);
    resposta = () => json({ outra: 1 }, 200);
    expect(await lerSituacaoEsqueci()).toBe(false);
    vi.stubGlobal('fetch', async () => { throw new Error('rede'); });
    expect(await lerSituacaoEsqueci()).toBe(false);
  });
});
