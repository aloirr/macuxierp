import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pacote from '../package.json';
import * as indice from './index';
import { plural } from './texto';

describe('texto de exibição do BKO (RD-0741)', () => {
  it('RD-0741: número com a palavra, no singular só com 1 (0 é plural em português)', () => {
    expect(plural(1, 'caractere', 'caracteres')).toBe('1 caractere');
    expect(plural(0, 'caractere', 'caracteres')).toBe('0 caracteres');
    expect(plural(2, 'caractere', 'caracteres')).toBe('2 caracteres');
    expect(plural(-1, 'dia', 'dias')).toBe('-1 dia');
    expect(plural(1500, 'arquivo', 'arquivos')).toBe('1500 arquivos');
    expect(`${plural(1, 'caractere', 'caracteres')} a mais`).toBe('1 caractere a mais');
  });

  it('sai pelo índice e pelo subcaminho ./texto, sem dependência de Node (o shell importa no navegador)', () => {
    expect(indice.plural).toBe(plural);
    expect((pacote.exports as Record<string, string>)['./texto']).toBe('./src/texto.ts');
    const fonte = readFileSync(new URL('./texto.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s/m);
  });
});
