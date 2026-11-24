import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertaBloqueante, deveFocarAlerta } from './AlertaBloqueante.js';
import { Dialogo } from './Dialogo.js';

describe('aviso fixo do Dialogo (T-0068)', () => {
  for (const tom of ['erro', 'aviso'] as const) {
    it(`tomAviso ${tom}: 15 px e peso 600`, () => {
      const h = renderToStaticMarkup(<Dialogo titulo="T" aoFechar={() => {}} aviso="Sem volta" tomAviso={tom}>x</Dialogo>);
      const av = /data-aviso-dialogo="" style="([^"]*)"/.exec(h)?.[1] ?? '';
      expect(av).toContain('font-size:var(--mx-tamanho-base)');
      expect(av).toContain('font-weight:var(--mx-peso-rotulo-campo)');
    });
  }
});

describe('AlertaBloqueante (T-0068)', () => {
  const h = renderToStaticMarkup(<AlertaBloqueante titulo="Nota não emitida" acao={<button>Corrigir</button>}>Falta a IE do destinatário.</AlertaBloqueante>);
  it('role alert, barra de 4 px em erro-texto, fundo erro-fundo, tabulável por programa', () => {
    expect(h).toContain('role="alert"');
    expect(h).toContain('tabindex="-1"');
    expect(h).toContain('border-left:4px solid var(--mx-cor-erro-texto)');
    expect(h).toContain('background:var(--mx-cor-erro-fundo)');
  });
  it('ícone decorativo e título 15 px peso 600', () => {
    expect(h).toMatch(/<svg aria-hidden="true"/);
    expect(h).toMatch(/data-alerta-titulo="" style="[^"]*font-size:var\(--mx-tamanho-base\)[^"]*font-weight:var\(--mx-peso-rotulo-campo\)/);
  });
  it('ordem: título, texto, ação', () => {
    expect(h.indexOf('Nota não emitida')).toBeLessThan(h.indexOf('Falta a IE'));
    expect(h.indexOf('Falta a IE')).toBeLessThan(h.indexOf('Corrigir'));
  });
  it('foco: não rouba de campo de digitação, aceita corpo e botão', () => {
    const el = (tag: string, ed = false) =>
      ({ tagName: tag, matches: () => ed }) as unknown as Element;
    const botao = el('BUTTON');
    const alerta = { contains: (x: unknown) => x === botao } as unknown as Element;
    expect(deveFocarAlerta(el('BODY'), alerta)).toBe(true);
    expect(deveFocarAlerta(null, alerta)).toBe(true);
    expect(deveFocarAlerta(el('INPUT', true), alerta)).toBe(false);
    expect(deveFocarAlerta(botao, alerta)).toBe(false);
    expect(deveFocarAlerta(el('A'), alerta)).toBe(true);
  });
});
