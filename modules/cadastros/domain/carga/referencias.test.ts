import { describe, expect, it } from 'vitest';
import type { LinhaPrazoPagamento, LinhaProdutoUnidade } from '../../contracts';
import { acrescentarIdsDoLote, conferirReferencias, idsVazios, separarDuplicados } from './referencias';

const unidade = (linha: number, produto: string): LinhaProdutoUnidade => ({
  linha, external_id: `U${linha}`, avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto },
});

describe('referências e duplicados do lote', () => {
  it('D13: a referência vale se está no banco ou numa linha válida do mesmo lote', () => {
    const ids = idsVazios();
    ids.produto.add('NO-BANCO');
    acrescentarIdsDoLote(ids, 'produto', [{ linha: 2, external_id: 'NO-LOTE', avisos: [], dados: {} }]);
    const r = conferirReferencias('produto_unidade', [unidade(2, 'NO-BANCO'), unidade(3, 'NO-LOTE'), unidade(4, 'SUMIU')], ids);
    expect(r.validas.map((l) => l.linha)).toEqual([2, 3]);
    expect(r.erros).toEqual([
      { linha: 4, campo: 'produto_external_id', codigo: 'CARGA_REFERENCIA', motivo: 'Referência não encontrada no banco nem neste lote' },
    ]);
  });
  it('D13: arquivo recusado não entra em idsDoLote, então quem dependia dele cai em CARGA_REFERENCIA', () => {
    const r = conferirReferencias('produto_unidade', [unidade(2, 'P1')], idsVazios());
    expect(r.erros[0]?.codigo).toBe('CARGA_REFERENCIA');
  });
  it('D13: a condição de pagamento do cliente aponta para o prazo do lote e a forma para a forma', () => {
    const ids = idsVazios();
    const prazo: LinhaPrazoPagamento = { linha: 2, external_id: 'PZ1', avisos: [], dados: {}, refs: { forma: 'F1' } };
    acrescentarIdsDoLote(ids, 'prazo_pagamento', [prazo]);
    expect(ids.condicao_pagamento.has('PZ1')).toBe(true);
    expect(conferirReferencias('prazo_pagamento', [prazo], ids).erros).toHaveLength(1);
  });
  it('RN-CORE-05: external_id repetido no arquivo recusa a 2ª ocorrência', () => {
    const r = separarDuplicados([
      { linha: 2, external_id: 'A' }, { linha: 3, external_id: 'B' }, { linha: 4, external_id: 'A' },
    ]);
    expect(r.unicas.map((l) => l.linha)).toEqual([2, 3]);
    expect(r.erros).toEqual([{ linha: 4, campo: 'external_id', codigo: 'CARGA_DUPLICADO', motivo: 'external_id repetido no arquivo' }]);
  });
});
