import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aliasCores, cores, escala, fontes, gerarCss, grade, pesos, variaveisCss } from './tokens.js';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('tokens da marca', () => {
  it('toda cor é hex de 6 dígitos', () => {
    for (const v of Object.values(cores)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('valores do manual', () => {
    expect(cores).toMatchObject({
      nevoa: '#ECEEF1',
      bordaTabela: '#DFE2E6',
      bordaCinza: '#C9CED5',
      bordaCampo: '#7A8593',
      azulClaro: '#9AA3B0',
      azulNoite: '#1E3350',
      solLaranja: '#C2540A',
      grafite: '#16202A',
      grafiteMenu: '#2B3743',
      verdeSucesso: '#1D6B4F',
      azulMedio: '#5B7FA6',
      graficoOutros: '#8B96A3',
      ativoFundo: '#E2F1EA',
      erroTexto: '#A8261B',
      erroFundo: '#FDE8E6',
      avisoTexto: '#7A4F00',
      avisoFundo: '#FFF1D6',
    });
  });
  it('sem cor duplicada: valor repetido só por alias', () => {
    const valores = Object.values(cores);
    expect(new Set(valores).size).toBe(valores.length);
    expect(aliasCores).toEqual({
      ativoTexto: 'verdeSucesso',
      inativoFundo: 'nevoa',
      linhaSuave: 'nevoa',
      graficoSerieCinza: 'textoSecundario',
      rotuloDestaque: 'azulNoite',
    });
  });
  it('bordaCampo (#232): borda de componente com token próprio; bordaCinza não muda', () => {
    expect(cores.bordaCampo).toBe('#7A8593');
    expect(cores.bordaCinza).toBe('#C9CED5');
    expect(css).toContain('--mx-cor-borda-campo: #7A8593;');
  });
  it('fontes sem @font-face e números tabulares', () => {
    expect(fontes.texto).toBe('system-ui, "Segoe UI", Roboto, -apple-system, sans-serif');
    expect(fontes.codigo).toBe('ui-monospace, "Cascadia Mono", "Roboto Mono", monospace');
    expect(fontes.numeros).toBe('tabular-nums');
    expect(css).not.toContain('@font-face');
  });
  it('escala 12, 13, 15, 17, 20, 24 e pesos 400, 500, 600, 700', () => {
    expect(Object.values(escala)).toEqual([12, 13, 15, 17, 20, 24]);
    expect(Object.values(pesos)).toEqual([400, 500, 600, 600, 600, 600, 600, 600, 600, 700]);
    const v = variaveisCss();
    expect(v['--mx-tamanho-titulo-cartao']).toBe('var(--mx-tamanho-grande)');
    expect(v['--mx-tamanho-titulo-dialogo']).toBe('var(--mx-tamanho-grande)');
    expect(v['--mx-tamanho-h1']).toBe('var(--mx-tamanho-titulo)');
    expect(v['--mx-tamanho-rotulo-menu']).toBe('var(--mx-tamanho-micro)');
    expect(v['--mx-tamanho-titulo-grupo']).toBe(v['--mx-tamanho-rotulo-menu']);
    expect(v['--mx-tamanho-selo']).toBe('var(--mx-tamanho-micro)');
  });
  it('telas horizontais (R-20261127-110345): grade', () => {
    expect(grade).toEqual({ cartaoMinimo: 280 });
    const v = variaveisCss();
    expect(v['--mx-grade-cartao-minimo']).toBe('280px');
  });
  it('hierarquia (R-20261127-110345): rótulo em destaque e diferente do valor', () => {
    const v = variaveisCss();
    expect(v['--mx-cor-rotulo-destaque']).toBe('var(--mx-cor-azul-noite)');
    expect(v['--mx-tamanho-rotulo-dado']).toBe('var(--mx-tamanho-pequeno)');
    expect(pesos.rotuloDado).toBeGreaterThan(pesos.normal);
  });
  it('tokens.css é exatamente o gerado do TS', () => {
    expect(css).toBe(gerarCss());
  });
});
