import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let resposta: () => Response;
const chamadas: { url: string; init: RequestInit }[] = [];
async function carregar() {
  vi.resetModules();
  vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
  vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
  return (await import('./login-unico')).loginUnico;
}
/**
 * Aquece o import uma vez, com folga própria: sob carga, a primeira transformação de ./login-unico e das dependências
 * passava dos 5 s no 1º caso. Depois, o vi.resetModules só reavalia o módulo, com a transformação em cache.
 */
beforeAll(async () => {
  await carregar();
}, 30_000);
afterAll(() => { vi.unstubAllEnvs(); vi.doUnmock('next/headers'); });
beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return resposta(); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock('next/headers'); });
const json = (c: unknown, s = 200, cookie?: string) => new Response(JSON.stringify(c), { status: s, headers: cookie ? { 'set-cookie': cookie } : {} });
const entrada = { empresa: 'AM2808', email: 'a@b.co', senha: 'x' };

describe('login único (SDK): POST /v1/auth/login, destino pela API', () => {
  it('uma rota só, com { empresa, email, senha }', async () => {
    const entrar = await carregar();
    resposta = () => json({ destino: 'bko', token_acesso: 't1', expira_em: '2026-11-23T20:00:00.000Z' }, 200, 'macuxierp_refresh=r1; Path=/; HttpOnly');
    await entrar(entrada);
    expect(chamadas[0]?.url).toBe('https://api.exemplo.invalid/v1/auth/login');
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual(entrada);
  });
  it('destino bko: acesso no corpo e refresh no cookie', async () => {
    const entrar = await carregar();
    resposta = () => json({ destino: 'bko', token_acesso: 't1', expira_em: '2026-11-23T20:00:00.000Z' }, 200, 'macuxierp_refresh=r1; Path=/; HttpOnly');
    expect(await entrar(entrada)).toEqual({ tipo: 'ok', sessao: { destino: 'bko', acesso: 't1', refresh: 'macuxierp_refresh=r1' } });
  });
  it('destino config: token do cookie da plataforma e expira_em', async () => {
    const entrar = await carregar();
    resposta = () => json({ destino: 'config', expira_em: '2026-11-23T20:00:00.000Z' }, 200, 'macuxierp_config=tok; Path=/v1/plataforma; HttpOnly');
    expect(await entrar(entrada)).toEqual({ tipo: 'ok', sessao: { destino: 'config', token: 'tok', expira_em: '2026-11-23T20:00:00.000Z' } });
  });
  it('todo login leva o CSRF do SDK (ADR 0018), no bko e no config', async () => {
    const entrar = await carregar();
    resposta = () => json({ destino: 'bko', token_acesso: 't1', expira_em: '2026-11-23T20:00:00.000Z' }, 200, 'macuxierp_refresh=r1; Path=/');
    await entrar(entrada);
    resposta = () => json({ destino: 'config', expira_em: '2026-11-23T20:00:00.000Z' }, 200, 'macuxierp_config=tok; Path=/v1/plataforma');
    await entrar(entrada);
    for (const c of chamadas) expect(c.init.headers).toMatchObject({ 'x-macuxierp-config': '1' });
    expect(chamadas).toHaveLength(2);
  });
  it('destino config sem cookie ou com token_acesso no corpo (strict): indisponível', async () => {
    const entrar = await carregar();
    resposta = () => json({ destino: 'config', expira_em: '2026-11-23T20:00:00.000Z' }, 200);
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
    resposta = () => json({ destino: 'config', expira_em: '2026-11-23T20:00:00.000Z', token_acesso: 'vazou' }, 200, 'macuxierp_config=tok; Path=/');
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
  });
  it('401 e 403: neutro; 429 com o prazo (limite por IP, não é bloqueio); 423 conta bloqueada; 400 com campos; 5xx e rede: indisponível', async () => {
    const entrar = await carregar();
    resposta = () => json({ codigo: 'NAO_AUTENTICADO' }, 401);
    expect(await entrar(entrada)).toEqual({ tipo: 'credencial' });
    resposta = () => json({ codigo: 'PERFIL_SEM_PERMISSAO' }, 403);
    expect(await entrar(entrada)).toEqual({ tipo: 'credencial' });
    resposta = () => json({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'x', detalhes: { retry_after_s: 420 } }, 429);
    expect(await entrar(entrada)).toEqual({ tipo: 'limite', retry_after_s: 420 });
    resposta = () => json({ codigo: 'CONTA_BLOQUEADA', mensagem: 'x', detalhes: { recuperar: true } }, 423);
    expect(await entrar(entrada)).toEqual({ tipo: 'bloqueada' });
    resposta = () => json({ codigo: 'VALIDACAO', mensagem: 'm', campos: { email: 'E-mail inválido' } }, 400);
    expect(await entrar(entrada)).toEqual({ tipo: 'campos', erros: { email: 'E-mail inválido' } });
    resposta = () => json({}, 500);
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
    resposta = () => json({ destino: 'bko', token_acesso: 't1', expira_em: '2026-11-23T20:00:00.000Z' }, 200);
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
    vi.stubGlobal('fetch', async () => { throw new Error('rede'); });
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
  });
  it('4xx com envelope da API (422): mostra a mensagem da API e loga só origem, status e código; sem envelope ou 503: indisponível', async () => {
    const entrar = await carregar();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resposta = () => json({ codigo: 'REGRA_PLATAFORMA', mensagem: 'Pedido recusado pelas regras da plataforma' }, 422);
    expect(await entrar(entrada)).toEqual({ tipo: 'recusado', mensagem: 'Pedido recusado pelas regras da plataforma' });
    const linha = String(log.mock.calls.at(-1)?.[0]);
    expect(linha).toContain('"origem":"login.status"');
    expect(linha).toContain('HTTP_422');
    expect(linha).toContain('REGRA_PLATAFORMA');
    expect(linha).not.toContain('Pedido recusado');
    log.mockClear();
    resposta = () => json({}, 422);
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
    expect(log).toHaveBeenCalledTimes(1);
    resposta = () => json({ codigo: 'X', mensagem: 'não deve aparecer' }, 503);
    expect(await entrar(entrada)).toEqual({ tipo: 'indisponivel' });
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
  it('o web não compara o código com nenhum valor reservado', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['./login-unico.ts', './login-regras.ts', '../app/login/entrar.ts', '../app/login/formulario.tsx']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/MACUXI\b|CODIGO_SUPERADMIN_LOGIN/);
    }
  });
});
