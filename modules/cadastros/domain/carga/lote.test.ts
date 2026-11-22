import { describe, expect, it } from 'vitest';
import type { LinhaEstoque, LinhaPreco } from '../../contracts';
import { ajusteDeCarga, conferirVigenciaDaTabela, somarSaldos } from './lote';

const est = (linha: number, saldo: number, filial = 'F1'): LinhaEstoque => ({ linha, external_id: `E${linha}`, avisos: [], saldo, refs: { produto: 'P1', filial } });
const preco = (linha: number, inicio: string, fim: string | null): LinhaPreco => ({
  linha, external_id: `PR${linha}`, avisos: [], preco_centavos: 100, refs: { produto: 'P1' },
  tabela: { external_id: 'T1', nome: 'Tabela Exemplo', vigencia_inicio: inicio, vigencia_fim: fim },
});

describe('regras de lote', () => {
  it('RN-CAD-07: o saldo da filial é a soma dos depósitos do arquivo', () => {
    const r = somarSaldos([est(2, 105_000), est(3, 42_500), est(4, 10_000, 'F2')]);
    expect(r.find((g) => g.filial === 'F1')?.saldo).toBe(147_500);
    expect(r).toHaveLength(2);
  });
  it('RN-CAD-07: a diferença para o saldo atual vira ajuste e diferença zero é sem mudança', () => {
    expect(ajusteDeCarga({ atual: 100_000, novo: 147_500, podeNegativo: false, linha: 2 })).toEqual({ ok: true, delta: 47_500 });
    expect(ajusteDeCarga({ atual: 5, novo: 5, podeNegativo: false, linha: 2 })).toEqual({ ok: true, delta: 0 });
  });
  it('RN-CAD-07: saldo negativo só com a permissão do gerente', () => {
    const r = ajusteDeCarga({ atual: 0, novo: -10_000, podeNegativo: false, linha: 7 });
    expect(r).toMatchObject({ ok: false, erro: { linha: 7, codigo: 'RN-CAD-07', campo: 'saldo' } });
    expect(ajusteDeCarga({ atual: 0, novo: -10_000, podeNegativo: true, linha: 7 })).toEqual({ ok: true, delta: -10_000 });
  });
  it('RN-CAD-06: vigência divergente na mesma tabela recusa a linha', () => {
    const erros = conferirVigenciaDaTabela([preco(2, '2026-01-01', null), preco(3, '2026-01-01', null), preco(4, '2026-02-01', null)]);
    expect(erros).toEqual([{ linha: 4, campo: 'vigencia_inicio', codigo: 'RN-CAD-06', motivo: 'Vigência diferente das outras linhas da mesma tabela' }]);
  });
});
