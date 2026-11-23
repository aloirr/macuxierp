import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ cookie: 'tok' as string | undefined, apagados: [] as unknown[], chamadas: [] as string[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'mx_config' && estado.cookie ? { value: estado.cookie } : undefined), delete: (x: unknown) => estado.apagados.push(x) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT ${d}`);
  },
}));
vi.mock('@/lib/config/api', () => ({
  sairPlataforma: async (t: string) => void estado.chamadas.push(`sair:${t}`),
  euPlataforma: async (t: string) => {
    estado.chamadas.push(`eu:${t}`);
    if (t === 'velho') throw new (await import('@/lib/config/erros')).ConfigNaoAutenticado();
    return {};
  },
}));

import { GET as encerrar } from '../sessao/encerrar/route';
import { sairConfigAcao } from './sair';
import { TopoPlataforma } from './topo-plataforma';

beforeEach(() => Object.assign(estado, { cookie: 'tok', apagados: [], chamadas: [] }));

describe('Sair é POST (server action), nunca GET', () => {
  it('revoga na API, apaga só o cookie do /config e volta ao login', async () => {
    await expect(sairConfigAcao()).rejects.toThrow('REDIRECT /config/entrar');
    expect(estado.chamadas).toEqual(['sair:tok']);
    expect(estado.apagados).toEqual([{ name: 'mx_config', path: '/config' }]);
  });
  it('o topo liga o Sair a um formulário com ação de servidor (sem link)', () => {
    const el = TopoPlataforma({ nome: 'Operadora' });
    const json = JSON.stringify(el, (_, v) => (typeof v === 'function' ? `fn:${v.name}` : v));
    expect(json).toContain('"action":"fn:');
    expect(json).not.toContain('sessao/encerrar');
  });
});

describe('GET /config/sessao/encerrar não desloga sessão válida', () => {
  it('sessão válida: volta ao portal e NÃO apaga o cookie', async () => {
    const r = await encerrar();
    expect(r.headers.get('location')).toBe('/config');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('API confirma 401: apaga o cookie do /config e vai ao login (Location relativo)', async () => {
    estado.cookie = 'velho';
    const r = await encerrar();
    expect(r.headers.get('location')).toBe('/config/entrar');
    const set = r.headers.get('set-cookie') ?? '';
    expect(set).toContain('mx_config=;');
    expect(set).toContain('Path=/config');
  });
  it('sem cookie: só vai ao login, sem chamar a API', async () => {
    estado.cookie = undefined;
    const r = await encerrar();
    expect(r.headers.get('location')).toBe('/config/entrar');
    expect(estado.chamadas).toEqual([]);
  });
});
