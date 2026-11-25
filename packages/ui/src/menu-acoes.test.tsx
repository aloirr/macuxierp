import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuAcoes, acaoTeclaGatilho, acaoTeclaMenu, ordenarAcoes, posicaoMenu, proximoItemMenu, type AcaoMenu, type MenuAcoesProps } from './MenuAcoes.js';
import * as pacote from './index.js';

const nada = () => {};
const a = (chave: string, extra: Partial<AcaoMenu> = {}): AcaoMenu => ({ chave, rotulo: chave.toUpperCase(), aoAcionar: nada, ...extra });
const render = (p: Partial<MenuAcoesProps> = {}) => renderToStaticMarkup(<MenuAcoes acoes={[a('log'), a('editar')]} {...p} />);
const aberto = (p: Partial<MenuAcoesProps> = {}) => render({ abertoInicial: true, ...p });
const rotulosDoMenu = (html: string) => [...html.matchAll(/role="menuitem"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('MenuAcoes (T-0099): gatilho', () => {
  it('rótulo "Ações" inteiro, com haspopup, expanded e controls', () => {
    const h = render();
    expect(h).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>Ações<\/button>/);
    expect(h).not.toContain('aria-controls');
    expect(h).not.toContain('⋯');
    expect(h).not.toContain('role="menu"');
  });
  it('aberto: expanded true e o aria-controls aponta para o role=menu', () => {
    const h = aberto();
    expect(h).toContain('aria-expanded="true"');
    const alvo = /aria-controls="([^"]+)"/.exec(h)?.[1];
    expect(h).toContain(`id="${alvo}"`);
    expect(h).toMatch(/<div[^>]*role="menu"/);
    expect(h.match(/role="menuitem"/g)?.length).toBe(2);
  });
  it('rotuloLinha vira aria-label "Ações de <linha>" e o texto visível continua "Ações"', () => {
    const h = render({ rotuloLinha: 'Pedido 123' });
    expect(h).toMatch(/aria-label="Ações de Pedido 123"[^>]*>Ações<\/button>/);
    expect(render()).not.toContain('aria-label=');
  });
  it('nenhum item (todos ocultos ou lista vazia) e sem principal: não renderiza o gatilho', () => {
    expect(render({ acoes: [] })).toBe('');
    expect(render({ acoes: [a('x', { oculto: true })] })).toBe('');
  });
});

describe('MenuAcoes (T-0099): ação principal', () => {
  it('aparece à vista ao lado do Ações, fora do menu', () => {
    const h = render({ principal: { rotulo: 'Reprocessar', aoAcionar: nada } });
    expect(h.indexOf('Reprocessar')).toBeGreaterThan(-1);
    expect(h.indexOf('Reprocessar')).toBeLessThan(h.indexOf('Ações'));
    expect(h.match(/Reprocessar/g)?.length).toBe(1);
  });
  it('sozinha, sem itens, renderiza só a principal; oculta, some', () => {
    const h = render({ acoes: [], principal: { rotulo: 'Log', aoAcionar: nada } });
    expect(h).toContain('Log');
    expect(h).not.toContain('aria-haspopup');
    expect(render({ acoes: [], principal: { rotulo: 'Log', aoAcionar: nada, oculto: true } })).toBe('');
  });
});

describe('MenuAcoes (T-0099): perigo, desabilitado e oculto', () => {
  const acoes = [a('zerar', { perigo: true }), a('log'), a('desativar', { perigo: true }), a('editar')];
  it('perigo sempre por último, depois do separador, mesmo fora de ordem', () => {
    const h = aberto({ acoes });
    expect(rotulosDoMenu(h)).toEqual(['LOG', 'EDITAR', 'ZERAR', 'DESATIVAR']);
    expect(h.match(/role="separator"/g)?.length).toBe(1);
    expect(h.indexOf('role="separator"')).toBeGreaterThan(h.indexOf('EDITAR'));
    expect(h.indexOf('role="separator"')).toBeLessThan(h.indexOf('ZERAR'));
  });
  it('perigo em vermelho (token de erro); item comum não', () => {
    const h = aberto({ acoes });
    expect(h).toMatch(/role="menuitem"[^>]*color:var\(--mx-cor-erro-texto\)[^>]*>ZERAR/);
    expect(h).not.toMatch(/color:var\(--mx-cor-erro-texto\)[^>]*>LOG/);
  });
  it('só perigo: sem separador solto', () => {
    expect(aberto({ acoes: [a('x', { perigo: true })] })).not.toContain('role="separator"');
  });
  it('desabilitado tem aria-disabled; oculto não aparece', () => {
    const h = aberto({ acoes: [a('a', { desabilitado: true }), a('b', { oculto: true }), a('c')] });
    expect(h).toMatch(/aria-disabled="true"[^>]*>A</);
    expect(rotulosDoMenu(h)).toEqual(['A', 'C']);
    expect(ordenarAcoes([a('b', { oculto: true })])).toEqual({ normais: [], perigos: [] });
  });
});

describe('MenuAcoes (T-0099): rótulo inteiro e posição fixa', () => {
  it('menu em position:fixed, sem ellipsis, nowrap e largura do conteúdo', () => {
    const h = aberto();
    expect(h).toMatch(/role="menu"[^>]*style="[^"]*position:fixed/);
    expect(h).toMatch(/role="menu"[^>]*width:max-content/);
    expect(h).not.toContain('ellipsis');
    expect(h).not.toContain('overflow');
    expect(h.match(/white-space:nowrap/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('posicaoMenu: abre abaixo e alinhado à direita; vira para cima e para a esquerda do gatilho quando não cabe', () => {
    const vp = { largura: 1000, altura: 800 };
    const m = { largura: 160, altura: 120 };
    expect(posicaoMenu({ top: 100, bottom: 140, left: 800, right: 900 }, m, vp)).toEqual({ top: 144, left: 740 });
    expect(posicaoMenu({ top: 720, bottom: 760, left: 800, right: 900 }, m, vp)).toEqual({ top: 596, left: 740 });
    expect(posicaoMenu({ top: 100, bottom: 140, left: 10, right: 60 }, m, vp)).toEqual({ top: 144, left: 10 });
    expect(posicaoMenu({ top: 100, bottom: 140, left: 950, right: 1000 }, m, vp).left).toBe(840);
  });
});

describe('MenuAcoes (T-0099): teclado', () => {
  const sem = [false, false, false, false];
  it('setas circulares', () => {
    expect(proximoItemMenu(sem, 0, 'ArrowDown')).toBe(1);
    expect(proximoItemMenu(sem, 3, 'ArrowDown')).toBe(0);
    expect(proximoItemMenu(sem, 0, 'ArrowUp')).toBe(3);
    expect(proximoItemMenu(sem, -1, 'ArrowDown')).toBe(0);
  });
  it('Home e End', () => {
    expect(proximoItemMenu(sem, 2, 'Home')).toBe(0);
    expect(proximoItemMenu(sem, 1, 'End')).toBe(3);
  });
  it('desabilitados são pulados (setas, Home, End, foco inicial)', () => {
    const d = [true, false, true, false, true];
    expect(proximoItemMenu(d, 1, 'ArrowDown')).toBe(3);
    expect(proximoItemMenu(d, 3, 'ArrowDown')).toBe(1);
    expect(proximoItemMenu(d, 1, 'ArrowUp')).toBe(3);
    expect(proximoItemMenu(d, 3, 'Home')).toBe(1);
    expect(proximoItemMenu(d, 1, 'End')).toBe(3);
    expect(proximoItemMenu(d, -1, 'ArrowDown')).toBe(1);
    expect(proximoItemMenu([true, true], 0, 'ArrowDown')).toBe(-1);
  });
  it('itens ficam fora do Tab (foco só por seta) e o gatilho continua na ordem normal', () => {
    const h = aberto();
    expect(h.match(/role="menuitem"[^>]*tabindex="-1"/g)?.length).toBe(2);
    expect(/<button[^>]*aria-haspopup[^>]*tabindex/.test(h)).toBe(false);
  });
});

describe('MenuAcoes (T-0099): alvo de 44 px no celular', () => {
  const css = readFileSync(new URL('./botoes.css', import.meta.url), 'utf8');
  it('botoes.css tem min-height 44px sob max-width 640px para .mx-acoes-alvo', () => {
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.mx-acoes-alvo \{\s*min-height: 44px;/);
  });
  it('gatilho, principal e itens usam a classe do alvo', () => {
    const h = aberto({ principal: { rotulo: 'Log', aoAcionar: nada } });
    expect(h.match(/class="[^"]*mx-acoes-alvo/g)?.length).toBe(4);
  });
  it('hover: névoa nos itens comuns; erroFundo e erroTexto no de perigo', () => {
    expect(css).toMatch(/\.mx-acoes-item:hover:not\(\[aria-disabled="true"\]\):not\(\.mx-acoes-perigo\) \{\s*background: var\(--mx-cor-nevoa\)/);
    expect(css).toMatch(/\.mx-acoes-item\.mx-acoes-perigo:hover:not\(\[aria-disabled="true"\]\) \{\s*background: var\(--mx-cor-erro-fundo\);\s*color: var\(--mx-cor-erro-texto\);/);
  });
  it('borda do menu usa bordaTabela', () => {
    expect(aberto()).toContain('border:1px solid var(--mx-cor-borda-tabela);border-radius:6px;box-shadow');
  });
  it('foco visível dos itens e do gatilho', () => {
    expect(css).toContain('.mx-acoes-item:focus-visible, .mx-acoes-gatilho:focus-visible');
  });
});

describe('MenuAcoes (T-0099): exportação', () => {
  it('o index exporta só o componente (auxiliares ficam no arquivo)', () => {
    expect(pacote.MenuAcoes).toBe(MenuAcoes);
    expect(Object.keys(pacote)).not.toContain('posicaoMenu');
  });
});

describe('MenuAcoes (T-0099): tecla no gatilho', () => {
  it('fechado: Enter, Espaço e ↓ abrem no primeiro; ↑ abre no último', () => {
    for (const t of ['Enter', ' ', 'ArrowDown']) expect(acaoTeclaGatilho(t, false)).toBe('abrir-primeiro');
    expect(acaoTeclaGatilho('ArrowUp', false)).toBe('abrir-ultimo');
  });
  it('aberto: setas e Enter entram no menu; Esc fecha', () => {
    expect(acaoTeclaGatilho('ArrowDown', true)).toBe('entrar-primeiro');
    expect(acaoTeclaGatilho('ArrowUp', true)).toBe('entrar-ultimo');
    expect(acaoTeclaGatilho('Enter', true)).toBe('entrar-primeiro');
    expect(acaoTeclaGatilho('Escape', true)).toBe('fechar');
  });
  it('Tab dentro do menu fecha e devolve o foco ao gatilho (Shift+Tab idem)', () => {
    expect(acaoTeclaMenu('Tab')).toBe('fechar-e-focar-gatilho');
    expect(acaoTeclaMenu('ArrowDown')).toBeNull();
  });
  it('Esc com o menu fechado e outras teclas não fazem nada', () => {
    expect(acaoTeclaGatilho('Escape', false)).toBeNull();
    expect(acaoTeclaGatilho('Tab', false)).toBeNull();
    expect(acaoTeclaGatilho('a', true)).toBeNull();
  });
});
