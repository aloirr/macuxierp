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
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), buscarEu, baixarArquivo, entrar: vi.fn(async () => ({ acesso: 'a', refresh: 'r=1' })) }));

import Casca from '../(shell)/layout';
import { entrarAction } from '../login/entrar';
import { GET } from '../baixar-modelo/route';
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
  it('login: com deve_trocar_senha vai direto a /senha', async () => {
    buscarEu.mockResolvedValue({ usuario: { deve_trocar_senha: true } });
    const f = new FormData();
    f.set('empresa', 'demo'); f.set('email', 'a@exemplo.invalid'); f.set('senha', 'x');
    await expect(entrarAction({}, f)).rejects.toThrow('REDIRECT /senha');
  });
  it('login: sem troca pendente vai ao destino', async () => {
    buscarEu.mockResolvedValue({ usuario: {} });
    const f = new FormData();
    f.set('empresa', 'demo'); f.set('email', 'a@exemplo.invalid'); f.set('senha', 'x'); f.set('destino', '/pedido');
    await expect(entrarAction({}, f)).rejects.toThrow('REDIRECT /pedido');
  });
  it('download: o 403 TROCAR_SENHA vira redirect RELATIVO para /senha (sem ERR_FAILED)', async () => {
    baixarArquivo.mockRejectedValue(new TrocarSenhaPendente());
    contexto.mockResolvedValue({ eu: { modulos: [{ id: 'cadastros', menus: [] }], usuario: { perfil: 'administrador' } } });
    const r = await GET(new NextRequest('http://0.0.0.0:3000/baixar-modelo?caminho=%2Fv1%2Fcadastros%2Fcargas%2Fmodelos%2Fpreco'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('/senha');
  });
  it('download: 403 sem permissão continua 403', async () => {
    baixarArquivo.mockResolvedValue({ ok: false, status: 403 });
    contexto.mockResolvedValue({ eu: { modulos: [{ id: 'cadastros', menus: [] }], usuario: { perfil: 'administrador' } } });
    const r = await GET(new NextRequest('http://0.0.0.0:3000/baixar-modelo?caminho=%2Fv1%2Fcadastros%2Fcargas%2Fmodelos%2Fpreco'));
    expect(r.status).toBe(403);
  });
});
