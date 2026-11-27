import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ valores: {} as Record<string, string>, apagados: [] as unknown[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.valores[n] ? { value: jar.valores[n] } : undefined),
    delete: (x: unknown) => jar.apagados.push(x),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT ${d}`);
  },
}));
vi.mock('../api', () => ({ buscarEu: vi.fn(async () => ({ filiais: [] })), NaoAutenticado: class extends Error {} }));

import { COOKIE_ACESSO, COOKIE_FILIAL, COOKIE_REFRESH, contexto } from '../sessao';
import { COOKIE_CONFIG_WEB, opcoesConfig, tokenConfig, exigirTokenConfig, encerrarEVoltar } from './sessao';

beforeEach(() => {
  jar.valores = {};
  jar.apagados = [];
});

describe('sessão de superadmin separada do BKO (ADR 0012)', () => {
  it('nome e path do cookie do /config diferem dos do BKO', () => {
    expect([COOKIE_ACESSO, COOKIE_REFRESH, COOKIE_FILIAL]).not.toContain(COOKIE_CONFIG_WEB);
    expect(COOKIE_CONFIG_WEB).not.toBe('macuxierp_config'); // o da API tem outro nome e outro path
  });
  it('opções: httpOnly, strict, path /config e secure só em produção', () => {
    expect(opcoesConfig()).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/config', secure: false });
    vi.stubEnv('NODE_ENV', 'production');
    expect(opcoesConfig().secure).toBe(true);
    vi.unstubAllEnvs();
  });
  it('o vencimento vem da API e nunca passa de 8 h', () => {
    const agora = new Date('2026-11-23T12:00:00.000Z');
    expect(opcoesConfig('2026-11-23T12:30:00.000Z', agora).maxAge).toBe(1800);
    expect(opcoesConfig('2026-11-24T12:00:00.000Z', agora).maxAge).toBe(8 * 3600);
    expect(opcoesConfig('lixo', agora).maxAge).toBe(8 * 3600);
  });
  it('o cookie do BKO NÃO abre o /config', async () => {
    jar.valores = { [COOKIE_ACESSO]: 'a', [COOKIE_REFRESH]: 'r', [COOKIE_FILIAL]: 'f' };
    expect(await tokenConfig()).toBeNull();
    await expect(exigirTokenConfig()).rejects.toThrow(/^REDIRECT \/$/);
  });
  it('o cookie do /config NÃO abre o BKO', async () => {
    jar.valores = { [COOKIE_CONFIG_WEB]: 'tok' };
    await expect(contexto()).rejects.toThrow('REDIRECT /sessao/renovar');
  });
  it('com o cookie próprio, devolve o token', async () => {
    jar.valores = { [COOKIE_CONFIG_WEB]: 'tok' };
    expect(await tokenConfig()).toBe('tok');
  });
  it('sessão terminada apaga só o cookie do /config e volta ao login', async () => {
    await expect(encerrarEVoltar()).rejects.toThrow(/^REDIRECT \/$/);
    expect(jar.apagados).toEqual([{ name: 'mx_config', path: '/config' }]);
  });
});
