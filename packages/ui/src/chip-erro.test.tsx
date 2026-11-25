import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip.js';
import { cor } from './estilos.js';

describe('Chip com tom erro (T-0086)', () => {
  it('usa erroTexto sobre erroFundo e mostra o texto', () => {
    const html = renderToStaticMarkup(<Chip tom="erro">Falhou</Chip>);
    expect(html).toContain('Falhou');
    expect(html.toLowerCase()).toContain(cor('erroTexto').toLowerCase());
    expect(html.toLowerCase()).toContain(cor('erroFundo').toLowerCase());
  });
});
