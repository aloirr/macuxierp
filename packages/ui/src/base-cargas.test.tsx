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
  it('painel com o canto do cartão (8 px, medidas.cantoCartao)', () => {
    const h = renderToStaticMarkup(<Dialogo titulo="T" aoFechar={() => {}}>x</Dialogo>);
    expect(h).toContain('border-radius:var(--mx-medida-canto-cartao)');
  });
  it('altura até 90vh: título e rodapé fixos, corpo rola', () => {
    const h = renderToStaticMarkup(
      <Dialogo titulo="T" aoFechar={() => {}} rodape={<button type="button">Ok</button>}>
        <p>corpo</p>
      </Dialogo>,
    );
    const painel = /role="dialog"[^>]*style="([^"]*)"/.exec(h)?.[1] ?? '';
    expect(painel).toContain('max-height:calc(100vh - 48px)');
    expect(painel).toContain('display:flex');
    expect(painel).toContain('flex-direction:column');
    expect(painel).toContain('overflow:hidden');
    const corpo = /<div data-corpo-dialogo="" style="([^"]*)">(.*?)<\/div>/.exec(h);
    expect(corpo?.[1]).toContain('overflow-y:auto');
    expect(corpo?.[1]).toContain('min-height:0');
    expect(corpo?.[2]).toContain('corpo');
    expect(corpo?.[2]).not.toContain('Ok');
    expect(h.indexOf('data-corpo-dialogo')).toBeGreaterThan(h.indexOf('<h2'));
    expect(h.indexOf('Ok')).toBeGreaterThan(h.lastIndexOf('</p></div>'));
  });
  it('aviso fixo fora do corpo, ligado ao aria-describedby; corpo com respiro de foco', () => {
    const h = renderToStaticMarkup(
      <Dialogo titulo="T" aoFechar={() => {}} descricaoId="desc" aviso="Sem volta">
        <p id="desc">corpo</p>
      </Dialogo>,
    );
    const av = /<div id="([^"]+)" data-aviso-dialogo="" style="([^"]*)">Sem volta<\/div>/.exec(h);
    expect(av).not.toBeNull();
    expect(h.indexOf('Sem volta')).toBeLessThan(h.indexOf('data-corpo-dialogo'));
    expect(h.indexOf('Sem volta')).toBeGreaterThan(h.indexOf('<h2'));
    expect(av?.[2]).toContain('flex:none');
    expect(av?.[2]).toContain('border-radius:6px');
    expect(h).toMatch(new RegExp(`aria-describedby="desc ${av?.[1]}"`));
    const corpo = /<div data-corpo-dialogo="" style="([^"]*)">/.exec(h)?.[1] ?? '';
    expect(corpo).toContain('padding:4px');
    expect(corpo).not.toContain('padding-inline');
    expect(av?.[2]).toContain('color:var(--mx-cor-aviso-texto)');
    expect(av?.[2]).toContain('background:var(--mx-cor-aviso-fundo)');
  });
  it('tomAviso erro usa erroTexto sobre erroFundo', () => {
    const h = renderToStaticMarkup(
      <Dialogo titulo="T" aoFechar={() => {}} aviso="Sem volta" tomAviso="erro">
        x
      </Dialogo>,
    );
    const av = /data-aviso-dialogo="" style="([^"]*)"/.exec(h)?.[1] ?? '';
    expect(av).toContain('color:var(--mx-cor-erro-texto)');
    expect(av).toContain('background:var(--mx-cor-erro-fundo)');
  });
  it('sem aviso: só o descricaoId', () => {
    const h = renderToStaticMarkup(<Dialogo titulo="T" aoFechar={() => {}} descricaoId="d">x</Dialogo>);
    expect(h).toContain('aria-describedby="d"');
    expect(h).not.toContain('data-aviso-dialogo');
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
