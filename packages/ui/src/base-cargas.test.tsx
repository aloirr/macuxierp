import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaixaResumo } from './CaixaResumo.js';
import { Chip } from './Chip.js';
import { Dialogo } from './Dialogo.js';
import * as indice from './index.js';

describe('Chip', () => {
  it.each([
    ['sucesso', 'ativo-fundo', 'verde-sucesso'],
    ['aviso', 'aviso-fundo', 'aviso-texto'],
    ['neutro', 'inativo-fundo', 'texto-secundario'],
  ] as const)('tom %s', (tom, fundo, texto) => {
    const h = renderToStaticMarkup(<Chip tom={tom}>Ok</Chip>);
    expect(h).toContain(`background:var(--mx-cor-${fundo})`);
    expect(h).toContain(`color:var(--mx-cor-${texto})`);
    expect(h).toContain('white-space:nowrap');
    expect(h).toContain('border-radius:10px');
    expect(h).toContain('padding:2px 8px');
    expect(h).toContain('font-size:var(--mx-tamanho-selo)');
    expect(h).toContain('font-weight:var(--mx-peso-rotulo-pequeno)');
    expect(h).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
  });
});

describe('CaixaResumo', () => {
  it.each([
    ['sucesso', 'ativo-fundo', 'verde-sucesso'],
    ['aviso', 'aviso-fundo', 'aviso-texto'],
    ['erro', 'erro-fundo', 'erro-texto'],
  ] as const)('tom %s', (tom, fundo, texto) => {
    const h = renderToStaticMarkup(<CaixaResumo tom={tom} numero={12} texto="notas" />);
    expect(h.startsWith('<div')).toBe(true);
    expect(h).toContain(`background:var(--mx-cor-${fundo})`);
    expect(h).toContain(`color:var(--mx-cor-${texto})`);
    expect(h).toContain(`border:1px solid var(--mx-cor-${texto})`);
    expect(h).toContain('border-radius:6px');
    expect(h).toContain('font-size:var(--mx-tamanho-grande)');
    expect(h).not.toContain('20px');
    expect(h).toContain('>12<');
    expect(h).toContain('notas');
    expect(h).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
  });
});

describe('Dialogo', () => {
  it('papel, aria, título, fundo e rodapé à direita', () => {
    const h = renderToStaticMarkup(
      <Dialogo titulo="Importar" aoFechar={() => {}} descricaoId="desc" rodape={<button type="button">Fechar</button>}>
        <p id="desc">Texto</p>
      </Dialogo>,
    );
    expect(h).toContain('role="dialog"');
    expect(h).toContain('tabindex="-1"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toMatch(/aria-labelledby="[^"]+-t"/);
    expect(h).toContain('aria-describedby="desc"');
    expect(h).toContain('<h2');
    expect(h).toContain('Importar');
    expect(h).toContain('opacity:0.55');
    expect(h).toContain('justify-content:flex-end');
    expect(h).toContain('Fechar');
  });
  it('sem descricaoId nem rodapé', () => {
    const h = renderToStaticMarkup(<Dialogo titulo="T" aoFechar={() => {}}>x</Dialogo>);
    expect(h).not.toContain('aria-describedby');
    expect(h).not.toContain('justify-content:flex-end');
  });
});

describe('index e cores', () => {
  it('exporta os três', () => {
    expect(indice.Chip).toBe(Chip);
    expect(indice.CaixaResumo).toBe(CaixaResumo);
    expect(indice.Dialogo).toBe(Dialogo);
  });
});
