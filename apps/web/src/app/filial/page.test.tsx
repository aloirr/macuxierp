import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const eu = vi.hoisted(() => ({ filiais: [] as { id: string; nome: string; cnpj: string }[] }));
vi.mock('@/lib/sessao', () => ({
  COOKIE_FILIAL: 'f',
  opcoesLongas: {},
  contexto: async () => ({ eu: { empresa: { razao_social: 'Acme' }, filiais: eu.filiais }, filial: null }),
}));
vi.mock('../(shell)/sair', () => ({ sairAction: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import SelecionarFilial from './page';

describe('tela Selecionar filial', () => {
  it('sem filiais: mostra o motivo e o Sair, sem Continuar', async () => {
    eu.filiais = [];
    const h = renderToStaticMarkup(await SelecionarFilial());
    expect(h).toContain('Nenhuma filial liberada para o seu usuário.');
    expect(h).toContain('>Sair<');
    expect(h).not.toContain('Continuar');
  });
  it('com filiais: mantém a lista e o Continuar', async () => {
    eu.filiais = [{ id: 'a', nome: 'Matriz', cnpj: '11222333000181' }];
    const h = renderToStaticMarkup(await SelecionarFilial());
    expect(h).toContain('Matriz');
    expect(h).toContain('Continuar');
    expect(h).not.toContain('Nenhuma filial liberada');
  });
});
