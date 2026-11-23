import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeloPlataforma } from './SeloPlataforma.js';
import * as indice from './index.js';
import { cores } from './tokens.js';

const luz = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luz(a), luz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('SeloPlataforma (T-0050 E5)', () => {
  const html = renderToStaticMarkup(<SeloPlataforma />);
  const fonte = readFileSync(new URL('./SeloPlataforma.tsx', import.meta.url), 'utf8');

  it('mostra o texto "Plataforma" e é exportado pelo índice', () => {
    expect(html).toContain('>Plataforma<');
    expect(indice.SeloPlataforma).toBe(SeloPlataforma);
  });

  it('cores por var() de token: fundo transparente, borda azulClaro e texto branco', () => {
    expect(html).toContain('background:transparent');
    expect(html).not.toContain('sol-claro');
    expect(html).toContain('border:1px solid var(--mx-cor-azul-claro)');
    expect(html).toContain('color:var(--mx-cor-branco)');
    expect(html).toContain('padding:1px 7px');
  });

  it('tamanho selo, peso rotulo-pequeno e canto de 10 px, como o .selo do shell', () => {
    expect(html).toContain('font-size:var(--mx-tamanho-selo)');
    expect(html).toContain('font-weight:var(--mx-peso-rotulo-pequeno)');
    expect(html).toContain('border-radius:10px');
  });

  it('contraste do texto e da borda sobre o grafite', () => {
    expect(contraste(cores.branco, cores.grafite)).toBeGreaterThanOrEqual(16);
    expect(contraste(cores.azulClaro, cores.grafite)).toBeGreaterThanOrEqual(6);
  });

  it('sem hook e sem diretiva de cliente', () => {
    for (const h of ['useState', 'useEffect', 'useId', 'useRef', 'use client']) expect(fonte).not.toContain(h);
  });
});
