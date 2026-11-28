import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./empresas/acoes', () => ({ maisEmpresasAcao: vi.fn(), situacaoAcao: vi.fn(), redefinirSenhaAdminAcao: vi.fn() }));

import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { ListaEmpresas } from './lista-empresas';

const base = { id: '11111111-1111-4111-8111-111111111111', slug: 'am0001', codigo: 'AM0001', nome: 'Comércio Fictício', fuso: 'America/Manaus', situacao: 'ativo', modulos: [], primeiro_admin: { id: '22222222-2222-4222-8222-222222222222', ativo: true, bloqueado: false }, created_at: '2026-11-22T12:00:00.000Z' } as unknown as EmpresaPlataforma;

describe('ListaEmpresas (T-0134)', () => {
  it('coluna Macuxi FDV: tem_fdv ausente vale Não; verdadeiro vale Sim', () => {
    const sem = renderToStaticMarkup(<ListaEmpresas empresas={[base]} vazio="v" />);
    expect(sem).toContain('>Macuxi FDV<');
    expect(sem).toContain('selo-inativo">Não<');
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[{ ...base, tem_fdv: true } as EmpresaPlataforma]} vazio="v" />)).toContain('selo-ativo">Sim<');
  });
  it('menu Ações por linha; encerrada sem ações fica sem menu', () => {
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[base]} vazio="v" />)).toContain('Ações de Comércio Fictício');
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[{ ...base, situacao: 'encerrado' } as EmpresaPlataforma]} vazio="v" />)).not.toContain('Ações de');
  });
  it('busca por código ou nome', () => {
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="v" />)).toContain('placeholder="Buscar por código ou nome"');
  });
});

describe('ListaEmpresas (36 A)', () => {
  it('o erro do "Carregar mais" fica no ResultadoAcao abaixo da tabela', () => {
    const h = renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="Nenhuma empresa." proximo="c1" />);
    expect(h.indexOf('data-resultado-acao')).toBeGreaterThan(h.indexOf('</table>'));
    expect(h).not.toContain('class="erro"');
  });
});
