import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cores, variaveisCss } from './tokens.js';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('tokens da marca', () => {
  it('toda cor é hex de 6 dígitos', () => {
    for (const v of Object.values(cores)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('valores do manual', () => {
    expect(cores.grafite).toBe('#16202A');
    expect(cores.grafiteMenu).toBe('#2B3743');
    expect(cores.bordaCinza).toBe('#C9CED5');
    expect(cores.bordaTabela).toBe('#DFE2E6');
    expect(cores.erroTexto).toBe('#A8261B');
  });
  it('tokens.css tem todas as variáveis --mx-* do TS, com o mesmo valor', () => {
    for (const [nome, valor] of Object.entries(variaveisCss())) {
      expect(css).toContain(`${nome}: ${valor};`);
    }
  });
});
