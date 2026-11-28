import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const renovarApi = vi.fn();
const buscarEu = vi.fn();

vi.mock('@/lib/api', () => ({
  renovar: (...a: unknown[]) => renovarApi(...a),
  buscarEu: (...a: unknown[]) => buscarEu(...a),
  ApiIndisponivel: class extends Error {},
  NaoAutenticado: class extends Error {},
  baixarArquivo: vi.fn(),
  baixarCsv: vi.fn(),
}));
const contexto = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/sessao', async (orig) => ({ ...(await orig<typeof import('@/lib/sessao')>()), contexto: () => contexto() }));

import { GET as renovar } from './sessao/renovar/route';
import { GET as baixar } from './baixar-arquivo/route';
import { GET as exportar } from './exportar-csv/route';
import { redirecionar } from '@/lib/redirecionar';

const H = { host: '0.0.0.0:3000', 'x-forwarded-host': 'erp.macuxifdv.com.br' };
const req = (caminho: string, cookie?: string) =>
  new NextRequest(`http://0.0.0.0:3000${caminho}`, { headers: { ...H, ...(cookie ? { cookie } : {}) } });

describe('redirects atrás do túnel (T-0021)', () => {
  beforeEach(() => {
    renovarApi.mockReset();
    buscarEu.mockReset();
    contexto.mockReset();
  });

  it('redirecionar: Location relativo e só caminho interno', () => {
    const r = redirecionar('/x');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/x');
    expect(redirecionar('//evil.com').headers.get('location')).toBe('/');
  });

  it('renovar sem refresh: 307 para / (tela de login) e apaga os dois cookies', async () => {
    const r = await renovar(req('/sessao/renovar'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/');
    expect(r.cookies.get('mx_acesso')?.value).toBe('');
    expect(r.cookies.get('mx_refresh')?.value).toBe('');
  });

  it('renovar com refresh válido: 307 para / e grava os dois cookies', async () => {
    renovarApi.mockResolvedValue({ acesso: 'A2', refresh: 'R2' });
    buscarEu.mockResolvedValue({});
    const r = await renovar(req('/sessao/renovar', 'mx_refresh=R1'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/');
    expect(r.cookies.get('mx_acesso')?.value).toBe('A2');
    expect(r.cookies.get('mx_refresh')?.value).toBe('R2');
  });

  const eu = { modulos: [{ id: 'faturamento', menus: ['Notas fiscais'] }], usuario: { perfil: 'administrador' } };

  it.each([
    ['baixar-arquivo', baixar, '/baixar-arquivo?caminho=/v1/faturamento/notas/3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70/xml'],
    ['exportar-csv', exportar, '/exportar-csv?rota=/faturamento/notas'],
  ])('%s sem cookie de acesso: 307 para /sessao/renovar', async (_nome, rota, url) => {
    contexto.mockResolvedValue({ eu });
    const r = await rota(req(url));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/sessao/renovar');
  });
});
