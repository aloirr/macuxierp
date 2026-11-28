import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { valoresDaRegra } from '@macuxierp/fiscal/web';
import { FormularioRegra } from './formulario-regra';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/acoes-cliente', () => ({ escrever: vi.fn() }));

const render = (perfil: 'fiscal' | 'gerente', modo: 'criar' | 'editar') => renderToStaticMarkup(
  <FormularioRegra modo={modo} perfil={perfil} valores={valoresDaRegra()} {...(modo === 'editar' ? { id: '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70', versao: '2026-11-28T10:00:00.000Z' } : {})} />,
);

describe('formulário da regra fiscal (regras 11 e 12, T-0127)', () => {
  it('uma barra de botões só, no rodapé: Salvar e Descartar à esquerda, Excluir (vermelho) à direita', () => {
    const h = render('fiscal', 'editar');
    expect(h.match(/barra-bloco/g)).toHaveLength(1);
    expect(h.lastIndexOf('barra-bloco')).toBeGreaterThan(h.lastIndexOf('</fieldset>'));
    expect(h.indexOf('Salvar alterações')).toBeLessThan(h.indexOf('Descartar'));
    expect(h.indexOf('Descartar')).toBeLessThan(h.indexOf('Excluir regra'));
    expect(h).toMatch(/botao-perigo-contorno[^"]*botao-direita/);
  });
  it('nova regra não tem Excluir; campo curto ocupa 1 a 2 colunas da grade de 12', () => {
    const h = render('fiscal', 'criar');
    expect(h).toContain('Salvar regra');
    expect(h).not.toContain('Excluir regra');
    expect(h).toContain('campo-col-1');
    expect(h).not.toContain('campo-col-12');
  });
  it('rótulos e dicas em português: nada de nome de coluna na tela', () => {
    const h = render('fiscal', 'criar');
    for (const t of ['NCM (código do produto)', 'Situação tributária (CST/CSOSN)', 'Margem de valor agregado, original (%)', 'Os 2 a 8 primeiros dígitos']) expect(h).toContain(t);
    expect(h).not.toMatch(/>(ncm_prefixo|mva_original|aliquota_icms)</);
  });
  it('quem só vê (gerente): campos desligados e sem barra de escrita', () => {
    const h = render('gerente', 'editar');
    expect(h).not.toContain('Salvar');
    expect(h).not.toContain('Excluir regra');
    expect(h).toContain('Voltar');
    expect(h).toMatch(/<input[^>]*disabled/);
  });
});
