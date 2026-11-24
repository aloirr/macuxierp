import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eu = vi.hoisted(() => ({ troca: undefined as boolean | undefined }));
const redirect = vi.hoisted(() => vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }));
const buscarEu = vi.hoisted(() => vi.fn());
const baixarArquivo = vi.hoisted(() => vi.fn());
const contexto = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sessao', async (orig) => ({
  ...(await orig<typeof import('@/lib/sessao')>()),
  contexto: (...a: unknown[]) => (contexto.getMockImplementation() ? contexto(...a) : padrao()),
}));
const padrao = async () => ({
    eu: { usuario: { nome: 'Pessoa', perfil: 'administrador', deve_trocar_senha: eu.troca }, empresa: { razao_social: 'Acme' }, filiais: [{ id: 'f', nome: 'Matriz' }], modulos: [] },
    filial: { id: 'f', nome: 'Matriz' },
  });
vi.mock('next/navigation', () => ({ redirect, usePathname: () => '/pedido/lista', useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'tok' }), set: vi.fn() }) }));
vi.mock('../(shell)/sair', () => ({ sairAction: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), buscarEu, baixarArquivo}));

import Casca from '../(shell)/layout';
import { GET } from '../baixar-arquivo/route';
import { TrocarSenhaPendente } from '@/lib/troca-pendente';

describe('bloqueio do shell até a troca (T-0052)', () => {
  beforeEach(() => { redirect.mockClear(); buscarEu.mockReset(); baixarArquivo.mockReset(); contexto.mockReset(); });

  it('layout: deve_trocar_senha leva a /senha antes de qualquer conteúdo', async () => {
    eu.troca = true;
    await expect(Casca({ children: 'x' })).rejects.toThrow('REDIRECT /senha');
  });
  it('layout: sem troca pendente renderiza o menu, com "Trocar senha" apontando para a página atual', async () => {
    eu.troca = undefined;
    const h = renderToStaticMarkup(await Casca({ children: 'x' }));
    expect(h).toContain('Trocar senha');
    expect(h).toContain('href="/senha?destino=%2Fpedido%2Flista"');
  });
  it('download: o 403 TROCAR_SENHA vira redirect RELATIVO para /senha (sem ERR_FAILED)', async () => {
    baixarArquivo.mockRejectedValue(new TrocarSenhaPendente());
    contexto.mockResolvedValue({ eu: { modulos: [{ id: 'faturamento', menus: [] }], usuario: { perfil: 'administrador' } } });
    const r = await GET(new NextRequest('http://0.0.0.0:3000/baixar-arquivo?caminho=%2Fv1%2Ffaturamento%2Fnotas%2F3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70%2Fxml'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/senha');
  });
  it('download: 403 sem permissão continua 403', async () => {
    baixarArquivo.mockResolvedValue({ ok: false, status: 403 });
    contexto.mockResolvedValue({ eu: { modulos: [{ id: 'faturamento', menus: [] }], usuario: { perfil: 'administrador' } } });
    const r = await GET(new NextRequest('http://0.0.0.0:3000/baixar-arquivo?caminho=%2Fv1%2Ffaturamento%2Fnotas%2F3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70%2Fxml'));
    expect(r.status).toBe(403);
  });
});
