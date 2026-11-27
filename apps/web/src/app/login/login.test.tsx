import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('./entrar', () => ({ entrarAction: vi.fn() }));
vi.mock('./esqueci', () => ({ pedirEsqueciAction: vi.fn() }));

import { VisaoLogin } from './formulario';
import { resultadoErro } from '@/lib/resultado-acao';

const vazio = { empresa: '', email: '', senha: '' };

describe('tela única de login (T-0076)', () => {
  it('três campos na ordem, olho só na senha, Entrar, sem "Sou de uma empresa" e sem o código reservado', () => {
    const h = renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} />);
    const pos = ['Código da empresa', 'E-mail', 'Senha', 'Entrar'].map((t) => h.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(h).toContain('name="empresa"');
    expect(h).toContain('type="email"');
    expect(h).toContain('autoComplete="username"');
    expect(h).toContain('type="password"');
    expect(h.match(/aria-label="Mostrar senha"/g)).toHaveLength(1);
    expect(h).not.toContain('aria-pressed');
    expect(h).toContain('autoComplete="current-password"');
    expect(h).toContain('id="login-senha"');
    expect(h).not.toContain('Sou de uma empresa');
    expect(h.toUpperCase()).not.toContain('MACUXI');
  });
  it('olho do CampoSenha (T-0094): alterna rótulo e tipo; o clique chama aoAlternarSenha', () => {
    const visivel = renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} senhaVisivel />);
    expect(visivel).toMatch(/<input[^>]*id="login-senha"[^>]*type="text"|<input[^>]*type="text"[^>]*id="login-senha"/);
    const alternar = vi.fn();
    const arvore = VisaoLogin({ destino: '/', valores: vazio, aoAlternarSenha: alternar });
    const achar = (n: unknown): { props: { aoAlternar?: () => void } } | undefined => {
      if (!n || typeof n !== 'object') return undefined;
      const el = n as { type?: { name?: string }; props?: { children?: unknown } };
      if (el.type?.name === 'CampoSenha') return n as { props: { aoAlternar?: () => void } };
      return [el.props?.children].flat(Infinity).map(achar).find(Boolean);
    };
    achar(arvore)?.props.aoAlternar?.();
    expect(alternar).toHaveBeenCalledTimes(1);
  });
  it('estados: carregando, erro de login (role alert, neutro), erro de campo por aria', () => {
    expect(renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} pendente />)).toMatch(/disabled=""[^>]*>Entrando…/);
    expect(renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} pendente />)).toContain('aria-busy="true"');
    const e = renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} resultado={resultadoErro('Empresa, e-mail ou senha incorretos.')} />);
    expect(e).toContain('role="alert"');
    expect(e).toContain('Empresa, e-mail ou senha incorretos.');
    const c = renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} erros={{ empresa: 'Informe o código da empresa.', senha: 'Informe a senha.' }} />);
    expect(c).toContain('class="erro-campo" id="login-erro-empresa"');
    expect(c).toContain('aria-describedby="login-erro-empresa"');
    expect(c).toContain('aria-invalid="true"');
    expect(c).toContain('Informe a senha.');
  });
  it('36 A: o erro do Entrar fica logo abaixo do botão, no ResultadoAcao, e não no topo do formulário', () => {
    const h = renderToStaticMarkup(<VisaoLogin destino="/" valores={vazio} resultado={resultadoErro('Empresa, e-mail ou senha incorretos.')} />);
    const botao = h.indexOf('>Entrar</button>');
    expect(botao).toBeGreaterThan(0);
    expect(h.indexOf('Empresa, e-mail ou senha incorretos.')).toBeGreaterThan(botao);
    expect(h).not.toContain('class="erro"');
    expect(h).toMatch(/<div role="alert"[^>]*><div style=[^>]*><span>Empresa, e-mail ou senha incorretos\.<\/span>/);
  });
  it('a senha nunca vem preenchida do servidor; o código lembrado preenche', () => {
    const h = renderToStaticMarkup(<VisaoLogin destino="/" valores={{ empresa: 'AM2808', email: '', senha: '' }} />);
    expect(h).toContain('value="AM2808"');
  });
  it('só o código vai ao navegador: nenhum storage, cookie ou URL com e-mail/senha no formulário', () => {
    const src = readFileSync(new URL('./formulario.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|searchParams|router\.(push|replace)/);
    expect(src).toContain('gravarCodigoDoLogin(r.entrou.destino, valores.empresa)');
    expect(src).not.toMatch(/gravarCodigoDoLogin\(r\.entrou\.destino, valores\.(email|senha)/);
    const lib = readFileSync(new URL('../../lib/codigo-salvo.ts', import.meta.url), 'utf8');
    expect(lib.match(/localStorage/g)?.length).toBeGreaterThan(0);
    expect(lib).not.toMatch(/sessionStorage|document\.cookie/);
    expect((lib.match(/setItem\(/g) ?? []).length).toBe(1);
  });
  it('a página mostra o link só com a situação do servidor', async () => {
    vi.resetModules();
    const situacao = vi.fn();
    vi.doMock('@/lib/esqueci-api', () => ({ lerSituacaoEsqueci: situacao }));
    const { TelaLogin } = await import('./tela');
    situacao.mockResolvedValue(true);
    expect(renderToStaticMarkup(await TelaLogin())).toContain('Esqueci a senha');
    situacao.mockResolvedValue(false);
    const h = renderToStaticMarkup(await TelaLogin());
    expect(h).not.toContain('Esqueci a senha');
    expect(h).toContain('Acesse sua conta');
    vi.doUnmock('@/lib/esqueci-api');
  });
});
