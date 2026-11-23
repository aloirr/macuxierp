import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15000 });

async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  return import('./api');
}
const resposta = (status: number, corpo: unknown) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));

describe('403 TROCAR_SENHA (T-0052)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('GET, escrita, CSV, arquivo e carga: viram TrocarSenhaPendente', async () => {
    vi.stubGlobal('fetch', resposta(403, { codigo: CODIGO_TROCAR_SENHA }));
    const { getValidado, escreverJson, baixarCsv, baixarArquivo, buscarRegistro, enviarCarga } = await carregar();
    const { TrocarSenhaPendente } = await import('./troca-pendente');
    const { z } = await import('zod');
    await expect(getValidado('/v1/x', z.unknown(), 't', 'x', true)).rejects.toBeInstanceOf(TrocarSenhaPendente);
    await expect(buscarRegistro('/v1/x', z.unknown(), 't', 'x')).rejects.toBeInstanceOf(TrocarSenhaPendente);
    await expect(escreverJson('POST', '/v1/x', {}, 't')).rejects.toBeInstanceOf(TrocarSenhaPendente);
    await expect(baixarCsv('/v1/x/exportar', 't')).rejects.toBeInstanceOf(TrocarSenhaPendente);
    await expect(baixarArquivo('/v1/x/y', 't')).rejects.toBeInstanceOf(TrocarSenhaPendente);
    await expect(enviarCarga('t', new FormData())).rejects.toBeInstanceOf(TrocarSenhaPendente);
  });
  it('403 sem permissão segue como SemPermissao / resposta de escrita', async () => {
    vi.stubGlobal('fetch', resposta(403, { codigo: 'SEM_PERMISSAO' }));
    const { getValidado, escreverJson, SemPermissao } = await carregar();
    const { z } = await import('zod');
    await expect(getValidado('/v1/x', z.unknown(), 't', 'x', true)).rejects.toBeInstanceOf(SemPermissao);
    expect((await escreverJson('POST', '/v1/x', {}, 't')).status).toBe(403);
  });
  it('eu traz deve_trocar_senha (ausente = falso)', async () => {
    const eu = { usuario: { id: '22222222-2222-4222-8222-222222222222', nome: 'P', perfil: 'faturista' }, empresa: { id: '33333333-3333-4333-8333-333333333333', slug: 'a', razao_social: 'A', fuso: 'America/Manaus' }, filiais: [], modulos: [] };
    vi.stubGlobal('fetch', resposta(200, { ...eu, usuario: { ...eu.usuario, deve_trocar_senha: true } }));
    const { buscarEu } = await carregar();
    expect((await buscarEu('t')).usuario.deve_trocar_senha).toBe(true);
    vi.stubGlobal('fetch', resposta(200, eu));
    expect((await buscarEu('t')).usuario.deve_trocar_senha).toBeUndefined();
  });
  it('trocarSenha: POST /v1/auth/senha e 204', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    const { trocarSenha } = await carregar();
    expect(await trocarSenha('t', 'macuxierp_refresh=r1', { senha_atual: 'a', senha_nova: 'b' })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.exemplo.invalid/v1/auth/senha');
    expect((init.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
    expect((init.headers as Record<string, string>).cookie).toBe('macuxierp_refresh=r1');
  });
});
