/** Pasta das migrações: MACUXI_DB_MIGRACOES vence a pasta do pacote; o parâmetro explícito vence a variável. Sem Postgres. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listarMigracoes } from '../src/migrar.ts';

const PASTA_PACOTE = fileURLToPath(new URL('../migrations/', import.meta.url));
const original = process.env.MACUXI_DB_MIGRACOES;
let temp: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'migrar-pasta-'));
  writeFileSync(join(temp, '0002_segunda.sql'), 'SELECT 2;\n');
  writeFileSync(join(temp, '0001_primeira.sql'), 'SELECT 1;\n');
  writeFileSync(join(temp, 'leia-me.txt'), 'ignorado\n');
});

afterEach(() => {
  if (original === undefined) delete process.env.MACUXI_DB_MIGRACOES;
  else process.env.MACUXI_DB_MIGRACOES = original;
  rmSync(temp, { recursive: true, force: true });
});

describe('listarMigracoes: pasta', () => {
  it('usa MACUXI_DB_MIGRACOES quando definida', () => {
    process.env.MACUXI_DB_MIGRACOES = temp;
    const ms = listarMigracoes();
    expect(ms.map((m) => m.nome)).toEqual(['0001_primeira.sql', '0002_segunda.sql']);
    expect(ms[0]?.caminho).toBe(join(temp, '0001_primeira.sql'));
    expect(ms[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolve caminho relativo contra o cwd', () => {
    process.env.MACUXI_DB_MIGRACOES = relative(process.cwd(), temp);
    expect(listarMigracoes().map((m) => m.nome)).toEqual(['0001_primeira.sql', '0002_segunda.sql']);
  });

  it('sem a variável (ou vazia) usa a pasta do pacote', () => {
    delete process.env.MACUXI_DB_MIGRACOES;
    const semVar = listarMigracoes();
    expect(semVar.length).toBeGreaterThan(2);
    expect(semVar.every((m) => m.caminho.startsWith(PASTA_PACOTE))).toBe(true);
    process.env.MACUXI_DB_MIGRACOES = '  ';
    expect(listarMigracoes().map((m) => m.nome)).toEqual(semVar.map((m) => m.nome));
  });

  it('o parâmetro explícito vence a variável', () => {
    process.env.MACUXI_DB_MIGRACOES = temp;
    const ms = listarMigracoes(PASTA_PACOTE);
    expect(ms.length).toBeGreaterThan(2);
    expect(ms.some((m) => m.nome === '0001_primeira.sql')).toBe(false);
  });

  it('pasta da variável inexistente = erro claro', () => {
    process.env.MACUXI_DB_MIGRACOES = join(temp, 'nao-existe');
    expect(() => listarMigracoes()).toThrow(/MACUXI_DB_MIGRACOES aponta para uma pasta que não existe/);
  });
});
