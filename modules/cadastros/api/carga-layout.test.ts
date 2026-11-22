import { describe, expect, it } from 'vitest';
import { classificarArquivo, LAYOUT } from '../domain';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');

describe('layout dos arquivos do kit (D1, D2)', () => {
  it('D1: os 10 arquivos entram, os 6 fora da v1 são ignorados e outro nome é recusado', () => {
    expect(classificarArquivo('Cliente.CSV')).toEqual({ classe: 'carga', entidade: 'cliente' });
    expect(classificarArquivo('titulo.csv')).toEqual({ classe: 'ignorado', entidade: 'titulo' });
    expect(classificarArquivo('qualquer.csv')).toEqual({ classe: 'recusado' });
    expect(classificarArquivo('cliente.xlsx')).toEqual({ classe: 'recusado' });
  });
  it('D2: as colunas obrigatórias de cada arquivo estão entre as usadas e a fixture tem os 11 arquivos', () => {
    for (const e of Object.keys(LAYOUT) as (keyof typeof LAYOUT)[]) {
      for (const o of LAYOUT[e].obrigatorias) expect([...LAYOUT[e].usadas, ...LAYOUT[e].ignoradas], `${e}.${o}`).toContain(o);
    }
    expect(readdirSync(pasta).filter((f) => f.endsWith('.csv'))).toHaveLength(11);
  });
});
