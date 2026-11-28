import { describe, expect, it } from 'vitest';
import { CAMPOS_CLIENTE } from './clientes';
import { camposDaFilial } from './filiais';
import type { Valores } from './edicao';

/** Soma das colunas por linha na grade de 12 (a regra 11 do CLAUDE.md), com o que o formulário mostra para os valores dados. */
function linhas(v: Valores): number[] {
  const out: number[] = [];
  let atual = 0;
  for (const c of camposDaFilial('administrador', 'criar')) {
    if (c.mostrarSe && !c.mostrarSe(v)) continue;
    const w = c.colunasSe ? c.colunasSe(v) : (c.colunas ?? 12);
    if (c.inicioLinha || atual + w > 12) { if (atual > 0) out.push(atual); atual = 0; }
    atual += w;
  }
  if (atual > 0) out.push(atual);
  return out;
}

describe('grade da filial (regra 11)', () => {
  it('RD: o número inicial da NF-e ocupa 2 colunas, como a série', () => {
    const c = (n: string) => camposDaFilial('administrador', 'editar').find((x) => x.nome === n)!;
    expect(c('nfe_numero_inicial').colunas).toBe(2);
    expect(c('nfe_serie').colunas).toBe(2);
  });
  it('RD: com CRT diferente de 3 o IPI toma o lugar do regime (6 colunas), sem buraco de 3', () => {
    const f = camposDaFilial('administrador', 'editar').find((x) => x.nome === 'industrial_ipi')!;
    expect(f.colunasSe!({ crt: '1' })).toBe(6);
    expect(f.colunasSe!({ crt: '3' })).toBe(3);
  });
  it('RD: com CRT 3 e com os demais, as três primeiras linhas da filial fecham em 12 colunas', () => {
    expect(linhas({ crt: '3' }).slice(0, 3)).toEqual([12, 12, 12]);
    expect(linhas({ crt: '1' }).slice(0, 3)).toEqual([12, 12, 12]);
  });
});

describe('dica da IE do cliente', () => {
  it('RD: a dica da IE é curta para 1366 px', () => {
    expect(CAMPOS_CLIENTE.find((c) => c.nome === 'ie')!.ajuda).toBe('Contribuinte: IE válida da UF. Isento: ISENTO ou vazio.');
  });
});
