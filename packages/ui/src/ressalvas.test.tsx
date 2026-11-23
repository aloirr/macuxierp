import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DialogoMotivo, avaliarConfirmacao } from './DialogoMotivo.js';
import { FormularioItens, type ItemLinha } from './FormularioItens.js';
import { centavosParaReais, reaisParaCentavos } from './entradas.js';
import { campoBase, focoVisivel, focoVisivelEscuro, gerarCssBotoes } from './estilos.js';

const motivos = [{ codigo: 'a', rotulo: 'A' }];
const item: ItemLinha = { chave: 'item-1', produtoId: 'p', quantidade: 1, precoUnitarioCentavos: 123456, descontoCentavos: 0 };
const form = () =>
  renderToStaticMarkup(
    <FormularioItens itens={[item]} aoMudar={() => {}} novoItem={(chave) => ({ ...item, chave })} calcularTotal={() => 0} formatarCentavos={String} renderSeletorProduto={() => null} />,
  );
const dialogo = (extra: Partial<Parameters<typeof DialogoMotivo>[0]> = {}) =>
  renderToStaticMarkup(<DialogoMotivo titulo="t" aoConfirmar={() => {}} aoCancelar={() => {}} {...extra} />);

describe('MC-0011: foco visível', () => {
  it('gerarCssBotoes inclui :focus-visible com azul-noite, do objeto focoVisivel', () => {
    expect(focoVisivel.outline).toBe('2px solid var(--mx-cor-azul-noite)');
    const css = gerarCssBotoes();
    expect(css).toContain('.mx-botao:focus-visible, .mx-botao-secundario:focus-visible {');
    expect(css).toContain('outline: 2px solid var(--mx-cor-azul-noite);');
    expect(css).toContain('outline-offset: 2px;');
  });
});

describe('foco em fundo escuro', () => {
  it('focoVisivelEscuro é branco e gerarCssBotoes gera .mx-fundo-escuro :focus-visible dele', () => {
    expect(focoVisivelEscuro.outline).toBe('2px solid var(--mx-cor-branco)');
    expect(focoVisivelEscuro.outlineOffset).toBe('2px');
    const css = gerarCssBotoes();
    expect(css).toMatch(/\.mx-fundo-escuro :focus-visible \{\n {2}outline: 2px solid var\(--mx-cor-branco\);/);
  });
});

describe('MC-0015: erro junto do campo no DialogoMotivo', () => {
  it('sem erro, nada de aria-invalid nem alert (a região status fica, vazia)', () => {
    const h = dialogo({ motivos, textoObrigatorio: true });
    expect(h).not.toContain('aria-invalid');
    expect(h).not.toContain('role="alert"');
  });
  it('E2: o validar do módulo só roda se a checagem básica não achou erro', () => {
    const validar = vi.fn(() => 'ruim');
    expect(avaliarConfirmacao({ texto: '' }, { motivos, validar })).toEqual({ campo: 'motivo', mensagem: 'Nenhum motivo escolhido. Escolha um da lista.' });
    expect(validar).not.toHaveBeenCalled();
    expect(avaliarConfirmacao({ motivo: 'a', texto: 'x' }, { motivos, validar })).toEqual({ campo: 'texto', mensagem: 'ruim' });
    expect(validar).toHaveBeenCalledTimes(1);
  });
});

describe('canto e campoBase', () => {
  it('campoBase: canto de 6 px; input e textarea usam', () => {
    expect(campoBase.borderRadius).toBe('6px');
    expect(form()).toMatch(/<input[^>]*border-radius:6px/);
    expect(dialogo()).toMatch(/<textarea[^>]*border-radius:6px/);
    expect(dialogo()).toMatch(/<textarea[^>]*font-size:var\(--mx-tamanho-pequeno\)/);
  });
});

describe('contorno do rádio', () => {
  it('sem accent-color', () => {
    expect(dialogo({ motivos })).not.toContain('accent-color');
  });
});

describe('RD-0723: campo de dinheiro sobre o sdk', () => {
  it('centavosParaReais: milhar, sem negativo, NaN e Infinity viram 0,00', () => {
    expect(centavosParaReais(100000000)).toBe('1.000.000,00');
    expect(centavosParaReais(-5)).toBe('0,00');
    expect(centavosParaReais(5.9)).toBe('0,05');
    expect(centavosParaReais(Number.NaN)).toBe('0,00');
    expect(centavosParaReais(Number.POSITIVE_INFINITY)).toBe('0,00');
    expect(centavosParaReais(Number.NEGATIVE_INFINITY)).toBe('0,00');
  });
  it('reaisParaCentavos: prefixo R$ (também com U+00A0), negativo e número grande', () => {
    expect(reaisParaCentavos('R$ 1.234,56')).toBe(123456);
    expect(reaisParaCentavos('R$\u00a01.234,56')).toBe(123456);
    expect(reaisParaCentavos('-1')).toBeNull();
    expect(reaisParaCentavos('99999999999999999999')).toBeNull();
  });
  it('ida e volta sem laço: texto com milhar → valor → mesmo texto', () => {
    for (const c of [0, 5, 99999, 123456, 987654321]) {
      expect(reaisParaCentavos(centavosParaReais(c))).toBe(c);
    }
    expect(form()).toContain('value="1.234,56"');
  });
});
