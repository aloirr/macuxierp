import { describe, expect, it } from 'vitest';
import type { LinhaPrazoPagamento, LinhaProdutoUnidade } from '../../contracts';
import { acrescentarIdsDoLote, conferirReferencias, idsVazios, separarDuplicados } from './referencias';

const unidade = (linha: number, produto: string): LinhaProdutoUnidade => ({
  linha, external_id: `U${linha}`, avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto },
});

describe('RF-CAD-11 (decisão de 23/11, v0.3.7): referência ausente é erro da linha, com entidade_faltante', () => {
  const cliente = (refs: Record<string, string>) => ({ linha: 2, external_id: 'C1', avisos: [], dados: {}, refs }) as never;
  it('RF-CAD-11: forma_external_id aponta para forma_pagamento (não "forma")', () => {
    const l: LinhaPrazoPagamento = { linha: 2, external_id: 'PZ1', avisos: [], dados: {}, refs: { forma: 'F9' } };
    expect(conferirReferencias('prazo_pagamento', [l], idsVazios()).erros[0]).toMatchObject({ campo: 'forma_external_id', codigo: 'CARGA_DEPENDENCIA', entidade_faltante: 'forma_pagamento' });
  });
  it('RF-CAD-11: tabela_preco_external_id aponta para preco (o arquivo da tabela)', () => {
    expect(conferirReferencias('cliente', [cliente({ tabela_preco: 'T9' })], idsVazios()).erros[0]).toMatchObject({ campo: 'tabela_preco_external_id', entidade_faltante: 'preco' });
  });
  it('RF-CAD-11: condicao_pagamento_external_id aponta para prazo_pagamento', () => {
    expect(conferirReferencias('cliente', [cliente({ condicao_pagamento: 'X9' })], idsVazios()).erros[0]).toMatchObject({ campo: 'condicao_pagamento_external_id', entidade_faltante: 'prazo_pagamento' });
  });
  it('RF-CAD-11: preço sem produto no banco nem no lote vira erro na linha (A0, sem o valor) e as demais linhas seguem', () => {
    const preco = (linha: number, produto: string) => ({ linha, external_id: `P${linha}`, avisos: [], dados: {}, refs: { produto } }) as never;
    const ids = idsVazios();
    ids.produto.add('OK');
    const r = conferirReferencias('preco', [preco(2, 'SUMIU'), preco(3, 'OK')], ids);
    expect(r.validas).toHaveLength(1);
    expect(r.erros).toEqual([{ linha: 2, campo: 'produto_external_id', codigo: 'CARGA_DEPENDENCIA', motivo: 'Preço produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.', entidade_faltante: 'produto' }]);
    expect(JSON.stringify(r.erros)).not.toContain('SUMIU');
  });
  it('RF-CAD-11: cliente com vendedor ausente vira linha com erro', () => {
    const ids = idsVazios();
    ids.filial.add('F1');
    const r = conferirReferencias('cliente', [cliente({ filial: 'F1', vendedor: 'V9' })], ids);
    expect(r.validas).toHaveLength(0);
    expect(r.erros).toMatchObject([{ campo: 'vendedor_external_id', codigo: 'CARGA_DEPENDENCIA', entidade_faltante: 'vendedor' }]);
  });
});

describe('referências e duplicados do lote', () => {
  it('D13: a referência vale se está no banco ou numa linha válida do mesmo lote', () => {
    const ids = idsVazios();
    ids.produto.add('NO-BANCO');
    acrescentarIdsDoLote(ids, 'produto', [{ linha: 2, external_id: 'NO-LOTE', avisos: [], dados: {} }]);
    const r = conferirReferencias('produto_unidade', [unidade(2, 'NO-BANCO'), unidade(3, 'NO-LOTE'), unidade(4, 'SUMIU')], ids);
    expect(r.validas.map((l) => l.linha)).toEqual([2, 3]);
    expect(r.erros).toEqual([
      { linha: 4, campo: 'produto_external_id', codigo: 'CARGA_DEPENDENCIA', motivo: 'Unidade do produto produto_external_id não encontrado: carregue o cadastro de produtos ou corrija a coluna produto_external_id.', entidade_faltante: 'produto' },
    ]);
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
