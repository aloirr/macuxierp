import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15000 });

/** O que o BFF manda à API em cada escrita das telas do core e da bandeira (T-0087, T-0088): método, Idempotency-Key, corpo e `content-type`. */
describe('escreverJson: PUT da bandeira, DELETE e ações sem corpo', () => {
  const enviados: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];

  async function carregar() {
    vi.resetModules();
    enviados.length = 0;
    vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
    vi.stubEnv('MACUXIERP_SEGREDO_BFF', '');
    vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
    vi.stubGlobal('fetch', async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      enviados.push({ url, init });
      return new Response(init.method === 'DELETE' ? null : JSON.stringify({ senha_provisoria: 'x' }), { status: init.method === 'DELETE' ? 204 : 200 });
    });
    return import('./api');
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('next/headers');
  });

  it('PUT leva Authorization, a Idempotency-Key do clique e o corpo JSON', async () => {
    const { escreverJson } = await carregar();
    const r = await escreverJson('PUT', '/v1/faturamento/filiais/f1/configuracao', { faturamento_real_nfe_simulada: true }, 'tok', { idempotencia: 'chave-do-clique-0001' });
    expect(r.ok).toBe(true);
    const e = enviados[0];
    expect(e?.url).toBe('https://api.exemplo.invalid/v1/faturamento/filiais/f1/configuracao');
    expect(e?.init.method).toBe('PUT');
    expect(e?.init.headers).toMatchObject({ authorization: 'Bearer tok', 'idempotency-key': 'chave-do-clique-0001', 'content-type': 'application/json' });
    expect(e?.init.body).toBe('{"faturamento_real_nfe_simulada":true}');
  });
  it('DELETE (inativar usuário) e POST sem corpo (redefinir senha) não mandam content-type nem corpo, para o Fastify não recusar JSON vazio', async () => {
    const { escreverJson } = await carregar();
    await escreverJson('DELETE', '/v1/core/usuarios/u1', undefined, 'tok', { idempotencia: 'chave-do-clique-0002' });
    await escreverJson('POST', '/v1/core/usuarios/u1/redefinir-senha', undefined, 'tok', { idempotencia: 'chave-do-clique-0003' });
    for (const e of enviados) {
      expect(e.init.headers['content-type']).toBeUndefined();
      expect(e.init.body).toBeUndefined();
      expect(e.init.headers['idempotency-key']).toMatch(/^chave-do-clique-/);
    }
  });
  it('PATCH de usuário leva o corpo com o token updated_at', async () => {
    const { escreverJson } = await carregar();
    await escreverJson('PATCH', '/v1/core/usuarios/u1', { perfil: 'gerente', updated_at: '2026-11-24T12:00:00.000Z' }, 'tok', { idempotencia: 'chave-do-clique-0004' });
    expect(JSON.parse(enviados[0]?.init.body ?? '{}')).toEqual({ perfil: 'gerente', updated_at: '2026-11-24T12:00:00.000Z' });
  });
});
