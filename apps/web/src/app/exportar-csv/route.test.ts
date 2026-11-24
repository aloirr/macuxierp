import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EU_FALSO } from '@/lib/falso';

const estado = vi.hoisted(() => ({ caminhos: [] as string[] }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'tok' }) }) }));
vi.mock('@/lib/sessao', () => ({ COOKIE_ACESSO: 'mx_acesso', contexto: async () => ({ eu: EU_FALSO }) }));
vi.mock('@/lib/redirecionar', () => ({ redirecionar: (d: string) => new Response(null, { status: 307, headers: { location: d } }) }));
vi.mock('@/lib/api', async () => {
  class NaoAutenticado extends Error {}
  return { NaoAutenticado, baixarCsv: async (c: string) => { estado.caminhos.push(c); return { corpo: new TextEncoder().encode('a;b').buffer, tipo: 'text/csv' }; } };
});

import { GET } from './route';

const pedir = (query: string) => GET(new NextRequest(`https://erp.exemplo.invalid/exportar-csv?${query}`));

describe('CSV das listas do core (T-0087)', () => {
  beforeEach(() => { estado.caminhos = []; });
  it('a auditoria exporta pela rota /exportar do módulo, sem cursor nem limite (a conversão de de/ate é de lib/telas/core.test.ts)', async () => {
    const r = await pedir('rota=/core/auditoria&de=2026-11-01&ate=2026-11-24&entidade=usuario&cursor=abc&limite=50');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('auditoria.csv');
    const url = new URL(`https://x.invalid${estado.caminhos[0]}`);
    expect(url.pathname).toBe('/v1/core/auditoria/exportar');
    expect(Object.fromEntries(url.searchParams)).toEqual({ de: expect.any(String), ate: expect.any(String), entidade: 'usuario' });
  });
  it('usuários e licenças têm o CSV pelas rotas /exportar do módulo', async () => {
    expect((await pedir('rota=/core/usuarios&busca=maria')).headers.get('content-disposition')).toContain('usuarios.csv');
    expect(estado.caminhos[0]).toBe('/v1/core/usuarios/exportar?busca=maria');
    expect((await pedir('rota=/core/licencas')).headers.get('content-disposition')).toContain('licencas.csv');
    expect(estado.caminhos[1]).toBe('/v1/core/licencas/exportar');
  });
  it('página sem CSV (perfis) responde 404', async () => {
    expect((await pedir('rota=/core/perfis')).status).toBe(404);
  });
});
