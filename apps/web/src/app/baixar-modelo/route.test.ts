import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const baixarArquivo = vi.fn();
const contexto = vi.fn();
const acesso = { valor: 'T' as string | undefined };
vi.mock('@/lib/api', () => ({ baixarArquivo: (...a: unknown[]) => baixarArquivo(...a), NaoAutenticado: class extends Error {} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (acesso.valor ? { value: acesso.valor } : undefined) }) }));
vi.mock('@/lib/sessao', async (orig) => ({ ...(await orig<typeof import('@/lib/sessao')>()), contexto: () => contexto() }));

import { GET } from './route';

const req = (caminho: string) => new NextRequest(`http://0.0.0.0:3000/baixar-modelo?caminho=${encodeURIComponent(caminho)}`);
const eu = (perfil: string, modulos = ['cadastros']) => ({ eu: { modulos: modulos.map((id) => ({ id, menus: [] })), usuario: { perfil } } });
const OK = '/v1/cadastros/cargas/modelos/preco';

describe('GET /baixar-modelo', () => {
  beforeEach(() => { baixarArquivo.mockReset(); contexto.mockReset(); acesso.valor = 'T'; });

  it('caminho fora da lista dá 404 sem chamar a API', async () => {
    contexto.mockResolvedValue(eu('administrador'));
    expect((await GET(req('/v1/cadastros/cargas/modelos/rota'))).status).toBe(404);
    expect(baixarArquivo).not.toHaveBeenCalled();
  });
  it('administrador e gerente baixam; o corpo e o nome do arquivo passam', async () => {
    baixarArquivo.mockResolvedValue({ ok: true, corpo: new TextEncoder().encode('a;b').buffer, tipo: 'text/csv; charset=utf-8', nome: 'preco.csv' });
    for (const p of ['administrador', 'gerente']) {
      contexto.mockResolvedValue(eu(p));
      const r = await GET(req(OK));
      expect(r.status).toBe(200);
      expect(r.headers.get('content-disposition')).toBe('attachment; filename="preco.csv"');
      expect(r.headers.get('content-type')).toContain('text/csv');
    }
    expect(baixarArquivo).toHaveBeenCalledWith(OK, 'T');
  });
  it('outros perfis ou módulo não licenciado: 404', async () => {
    for (const p of ['faturista', 'fiscal', 'vendedor', 'leitura']) {
      contexto.mockResolvedValue(eu(p));
      expect((await GET(req(OK))).status).toBe(404);
    }
    contexto.mockResolvedValue(eu('administrador', ['core']));
    expect((await GET(req(OK))).status).toBe(404);
    expect(baixarArquivo).not.toHaveBeenCalled();
  });
  it('sem cookie de acesso: 307 relativo para /sessao/renovar', async () => {
    acesso.valor = undefined;
    contexto.mockResolvedValue(eu('administrador'));
    const r = await GET(req(OK));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/sessao/renovar');
  });
  it('falha da API vira 502 com texto fixo', async () => {
    contexto.mockResolvedValue(eu('administrador'));
    baixarArquivo.mockResolvedValue({ ok: false, status: 500 });
    expect((await GET(req(OK))).status).toBe(502);
  });
});
