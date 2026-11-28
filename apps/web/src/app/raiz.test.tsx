import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import config, { ROTAS_ANTIGAS_DO_LOGIN } from '../../next.config';

const cookies = vi.hoisted(() => ({ valores: {} as Record<string, string> }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (cookies.valores[n] ? { value: cookies.valores[n] } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }) }));
vi.mock('./login/tela', () => ({ TelaLogin: () => <main>Acesse sua conta<input name="empresa" /></main> }));
vi.mock('./(shell)/casca', () => ({ Casca: ({ children }: { children: unknown }) => <div data-casca>{children as never}</div> }));

vi.mock('./(shell)/inicio', () => ({ Inicio: () => <h1>Início</h1> }));

import Raiz, { generateMetadata } from './page';

beforeEach(() => { cookies.valores = {}; });

describe('"/" é o login sem sessão e o BKO com sessão (v0.3.27, decisão 42 = A)', () => {
  it('sem cookie: mostra o login, sem redirect', async () => {
    const h = renderToStaticMarkup(await Raiz());
    expect(h).toContain('Acesse sua conta');
    expect(h).toContain('name="empresa"');
    expect(h).not.toContain('data-casca');
    expect(await generateMetadata()).toEqual({ title: 'Acesse sua conta' });
  });
  it.each(['mx_acesso', 'mx_refresh'])('com o cookie %s: mostra o BKO (a validade fica com a contexto())', async (nome) => {
    cookies.valores = { [nome]: 'x' };
    const h = renderToStaticMarkup(await Raiz());
    expect(h).toContain('data-casca');
    expect(h).toContain('Início');
    expect(h).not.toContain('name="empresa"');
    expect(await generateMetadata()).toEqual({});
  });
  it('só o cookie do /config não abre o BKO', async () => {
    cookies.valores = { mx_config: 'x' };
    expect(renderToStaticMarkup(await Raiz())).toContain('name="empresa"');
  });
  it('/login e /config/entrar redirecionam em 308 (permanent) para "/"', async () => {
    expect(ROTAS_ANTIGAS_DO_LOGIN).toEqual(['/login', '/config/entrar']);
    expect(await config.redirects!()).toEqual([{ source: '/login', destination: '/', permanent: true }, { source: '/config/entrar', destination: '/', permanent: true }]);
  });
});
