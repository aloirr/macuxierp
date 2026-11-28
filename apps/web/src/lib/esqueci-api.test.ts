import { CAMINHOS_ESQUECI_SENHA, MENSAGEM_ESQUECI_NEUTRA } from '@macuxierp/platform-sdk';
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
  it('sempre POST /v1/auth/esqueci, só com o e-mail em minúsculas (ADR 0021), sem empresa', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    resposta = () => json({ mensagem: MENSAGEM_ESQUECI_NEUTRA }, 202);
    expect(await pedirSenhaTemporaria({ email: 'A@B.co' })).toEqual({ tipo: 'ok' });
    expect(chamadas[0]?.url).toBe(`https://api.exemplo.invalid${CAMINHOS_ESQUECI_SENHA.tenant}`);
    expect(chamadas[0]?.url).not.toContain('plataforma');
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({ email: 'a@b.co' });
    expect(String(chamadas[0]?.init.body)).not.toContain('empresa');
  });
  it('429 com retry_after_s e 400 VALIDACAO', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    resposta = () => json({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'x', detalhes: { retry_after_s: 900 } }, 429);
    expect(await pedirSenhaTemporaria({ email: 'a@b.co' })).toEqual({ tipo: 'limite', texto: 'Muitas tentativas. Tente de novo em 15 minutos.' });
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { email: 'E-mail inválido' } }, 400);
    expect(await pedirSenhaTemporaria({ email: 'a@b.co' })).toEqual({ tipo: 'campos', erros: { email: 'E-mail inválido' } });
  });
  it('entrada inválida não chama a API', async () => {
    const { pedirSenhaTemporaria } = await carregar();
    expect(await pedirSenhaTemporaria({ email: 'x' })).toMatchObject({ tipo: 'campos', erros: { email: 'E-mail inválido. Confira o endereço.' } });
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
