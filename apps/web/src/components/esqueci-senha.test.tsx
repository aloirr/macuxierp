import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MENSAGEM_ESQUECI_NEUTRA } from '@macuxierp/platform-sdk';
import { ComEsqueciSenha, PainelEsqueciVisao, estadoDe } from './esqueci-senha';
import { FormularioLogin } from '@/app/login/formulario';
import { validarCampos } from '@/lib/login-regras';

vi.mock('@/app/login/entrar', () => ({ entrarAction: vi.fn() }));
vi.mock('@/app/login/esqueci', () => ({ pedirEsqueciAction: vi.fn() }));

const form = { fase: 'form', erros: {} } as const;

describe('painel Esqueci a senha (RN-CORE-13)', () => {
  it('confirmação neutra literal do SDK, com role=status, sem formulário', () => {
    const h = renderToStaticMarkup(<PainelEsqueciVisao estado={estadoDe({ tipo: 'ok' })} />);
    expect(h).toContain('role="status"');
    expect(h).toContain(MENSAGEM_ESQUECI_NEUTRA);
    expect(h).toContain('Ela vale por 72 horas.');
    expect(h).not.toContain('<form');
    expect(h).toContain('Voltar ao login');
  });
  it('limite: mostra o texto da API e mantém o formulário', () => {
    const h = renderToStaticMarkup(<PainelEsqueciVisao estado={estadoDe({ tipo: 'limite', texto: 'Muitas tentativas. Tente de novo em 3 minutos.' })} />);
    expect(h).toContain('Muitas tentativas. Tente de novo em 3 minutos.');
    expect(h).toContain('<form');
    expect(h).toContain('Enviar senha temporária');
  });
  it('erros de campo abaixo do campo, ligados por aria', () => {
    const erros = validarCampos(['empresa', 'email'], { empresa: '', email: 'x' });
    const h = renderToStaticMarkup(<PainelEsqueciVisao estado={{ fase: 'form', erros }} />);
    expect(h).toContain('Informe o código da empresa.');
    expect(h).toContain('E-mail inválido. Confira o endereço.');
    expect(h).toContain('aria-describedby="esqueci-erro-empresa"');
    expect(h).toContain('aria-invalid="true"');
  });
  it('painel para todos: Código da empresa (preenchido se salvo) e E-mail, sem "MACUXI"', () => {
    const h = renderToStaticMarkup(<PainelEsqueciVisao estado={form} valores={{ empresa: 'AM2808' }} />);
    expect(h).toContain('Código da empresa');
    expect(h).toContain('value="AM2808"');
    expect(h).toContain('name="email"');
    expect(h.toUpperCase()).not.toContain('MACUXI');
  });
});

describe('título único (h1) por estado', () => {
  const titulos = (h: string) => [...h.matchAll(/<h([1-6])[^>]*>([^<]*)</g)].map((m) => `h${m[1]}:${m[2]}`);
  it('painel (formulário e confirmação) não tem título próprio', () => {
    expect(titulos(renderToStaticMarkup(<PainelEsqueciVisao estado={form} />))).toEqual([]);
    expect(titulos(renderToStaticMarkup(<PainelEsqueciVisao estado={{ fase: 'confirmado', erros: {} }} />))).toEqual([]);
  });
  it('login fechado: um h1 "Acesse sua conta"', () => {
    expect(titulos(renderToStaticMarkup(<FormularioLogin destino="/" esqueciDisponivel />))).toEqual(['h1:Acesse sua conta']);
  });
  it('painel aberto: um h1 "Esqueci a senha" (form e confirmação)', async () => {
    vi.resetModules();
    vi.doMock('react', async (orig) => {
      const r = await orig<typeof import('react')>();
      return { ...r, default: r, useState: ((i: unknown) => (i === false ? [true, () => {}] : r.useState(i))) as typeof r.useState };
    });
    const { FormularioLogin: F } = await import('@/app/login/formulario');
    expect(titulos(renderToStaticMarkup(<F destino="/" esqueciDisponivel />))).toContain('h1:Esqueci a senha');
    vi.doUnmock('react');
  });
});

describe('link na tela única', () => {
  it('oculto quando indisponível, visível quando disponível', () => {
    const off = renderToStaticMarkup(<FormularioLogin destino="/" esqueciDisponivel={false} />);
    const on = renderToStaticMarkup(<FormularioLogin destino="/" esqueciDisponivel />);
    expect(off).not.toContain('Esqueci a senha');
    expect(on).toContain('Esqueci a senha');
    expect(renderToStaticMarkup(<FormularioLogin destino="/" />)).not.toContain('Esqueci a senha');
  });
  it('ComEsqueciSenha sem disponibilidade só renderiza o filho', () => {
    expect(renderToStaticMarkup(<ComEsqueciSenha disponivel={false}><i>f</i></ComEsqueciSenha>)).toBe('<i>f</i>');
  });
  it('o painel não usa storage, cookie nem URL (o código salvo vem do login)', () => {
    for (const f of ['./esqueci-senha.tsx', '../lib/esqueci-resultado.ts', '../lib/esqueci-api.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/localStorage|sessionStorage|document\.cookie|searchParams|router\.(push|replace)|\?email=/);
    }
  });
});
