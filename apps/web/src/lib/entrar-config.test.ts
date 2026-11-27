import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CSRF_CONFIG, CAMINHO_ENTRAR_PELO_BKO, CODIGO_SEM_ACESSO_CONFIG, CODIGO_TROCAR_SENHA, COOKIE_CONFIG, MENSAGEM_SEM_ACESSO_CONFIG } from '@macuxierp/platform-sdk';
import { lerEntrarConfig } from './entrar-config';

const EXPIRA = '2026-11-27T20:00:00.000Z';
const json = (c: unknown, s = 200, cookie?: string) => new Response(JSON.stringify(c), { status: s, headers: cookie ? { 'set-cookie': cookie } : {} });

describe('C1 (45 A): resposta de POST /v1/auth/config', () => {
  it('200 com o cookie do portal: abre a sessão (o token só do Set-Cookie)', async () => {
    expect(await lerEntrarConfig(json({ expira_em: EXPIRA }, 200, `${COOKIE_CONFIG}=tk1; Path=/v1/plataforma; HttpOnly`))).toEqual({ tipo: 'ok', token: 'tk1', expira_em: EXPIRA });
  });
  it('200 sem o cookie ou fora do contrato: indisponível', async () => {
    expect(await lerEntrarConfig(json({ expira_em: EXPIRA }))).toEqual({ tipo: 'indisponivel' });
    expect(await lerEntrarConfig(json({}, 200, `${COOKIE_CONFIG}=tk1`))).toEqual({ tipo: 'indisponivel' });
  });
  it('401: sessão do BKO inválida', async () => {
    expect(await lerEntrarConfig(json({ codigo: 'NAO_AUTENTICADO' }, 401))).toEqual({ tipo: 'sessao' });
  });
  it('403 TROCAR_SENHA: troca pendente', async () => {
    expect(await lerEntrarConfig(json({ codigo: CODIGO_TROCAR_SENHA }, 403))).toEqual({ tipo: 'trocar_senha' });
  });
  it('403 SEM_ACESSO_CONFIG: a mensagem da API ou a do SDK', async () => {
    expect(await lerEntrarConfig(json({ codigo: CODIGO_SEM_ACESSO_CONFIG, mensagem: MENSAGEM_SEM_ACESSO_CONFIG }, 403))).toEqual({ tipo: 'sem_acesso', texto: MENSAGEM_SEM_ACESSO_CONFIG });
    expect(await lerEntrarConfig(json({ codigo: CODIGO_SEM_ACESSO_CONFIG }, 403))).toEqual({ tipo: 'sem_acesso', texto: MENSAGEM_SEM_ACESSO_CONFIG });
  });
  it('outro 403 e 5xx: indisponível', async () => {
    expect(await lerEntrarConfig(json({ codigo: 'OUTRO' }, 403))).toEqual({ tipo: 'indisponivel' });
    expect(await lerEntrarConfig(new Response('x', { status: 503 }))).toEqual({ tipo: 'indisponivel' });
  });
});

describe('C1: a chamada leva o refresh do BKO e o CSRF, sem corpo', () => {
  const chamadas: { url: string; init: RequestInit }[] = [];
  async function carregar() {
    vi.resetModules();
    vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
    vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
    return (await import('./entrar-config')).entrarConfigPeloBko;
  }
  beforeAll(async () => { await carregar(); }, 30_000);
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); chamadas.length = 0; });
  afterAll(() => vi.doUnmock('next/headers'));

  it('POST no CAMINHO_ENTRAR_PELO_BKO com cookie e CABECALHO_CSRF_CONFIG', async () => {
    const entrar = await carregar();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return json({ expira_em: EXPIRA }, 200, `${COOKIE_CONFIG}=tk1; Path=/v1/plataforma`); });
    expect(await entrar('macuxierp_refresh=r1')).toEqual({ tipo: 'ok', token: 'tk1', expira_em: EXPIRA });
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0]!;
    expect(url).toBe(`https://api.exemplo.invalid${CAMINHO_ENTRAR_PELO_BKO}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    const h = new Headers(init.headers);
    expect(h.get('cookie')).toBe('macuxierp_refresh=r1');
    expect(h.get(CABECALHO_CSRF_CONFIG)).toBe('1');
  });
  it('sem refresh não chama a API; falha de rede vira indisponível', async () => {
    const entrar = await carregar();
    vi.stubGlobal('fetch', async () => { throw new Error('rede'); });
    expect(await entrar('')).toEqual({ tipo: 'sessao' });
    expect(await entrar('macuxierp_refresh=r1')).toEqual({ tipo: 'indisponivel' });
  });
});
