import { describe, expect, it } from 'vitest';
import type { LinhaCondicaoPagamento, LinhaProdutoUnidade } from '../../contracts';
import { acrescentarIdsDoLote, conferirReferencias, idsVazios, separarDuplicados } from './referencias';

const unidade = (linha: number, produto: string): LinhaProdutoUnidade => ({
  linha, external_id: `U${linha}`, avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto },
});

describe('RF-CAD-11 (decisão de 23/11, v0.3.7): referência ausente é erro da linha, com entidade_faltante', () => {
  const cliente = (refs: Record<string, string>) => ({ linha: 2, external_id: 'C1', avisos: [], dados: {}, refs }) as never;
  it('RF-CAD-11: tabela_preco_external_id aponta para preco (o arquivo da tabela)', () => {
    expect(conferirReferencias('cliente', [cliente({ tabela_preco: 'T9' })], idsVazios()).erros[0]).toMatchObject({ campo: 'tabela_preco_external_id', entidade_faltante: 'preco' });
  });
  it('T-0058: condicao_pagamento_external_id aponta para condicao_pagamento (a forma não é mais um arquivo)', () => {
    expect(conferirReferencias('cliente', [cliente({ condicao_pagamento: 'X9' })], idsVazios()).erros[0]).toMatchObject({ campo: 'condicao_pagamento_external_id', entidade_faltante: 'condicao_pagamento', motivo: 'Cliente condicao_pagamento_external_id não encontrado: carregue o cadastro de condições de pagamento ou corrija a coluna condicao_pagamento_external_id.' });
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
  it('T-0058: a condição de pagamento do cliente aponta para a condição do lote; a condição não tem referência de arquivo', () => {
    const ids = idsVazios();
    const cond: LinhaCondicaoPagamento = { linha: 2, external_id: 'PZ1', avisos: [], dados: { forma_external_id: 'F1' } };
    acrescentarIdsDoLote(ids, 'condicao_pagamento', [cond]);
    expect(ids.condicao_pagamento.has('PZ1')).toBe(true);
    expect(conferirReferencias('condicao_pagamento', [cond], ids).erros).toEqual([]);
  });
  it('RN-CORE-05: external_id repetido no arquivo recusa a 2ª ocorrência', () => {
    const r = separarDuplicados([
      { linha: 2, external_id: 'A' }, { linha: 3, external_id: 'B' }, { linha: 4, external_id: 'A' },
    ]);
    expect(r.unicas.map((l) => l.linha)).toEqual([2, 3]);
    expect(r.erros).toEqual([{ linha: 4, campo: 'external_id', codigo: 'CARGA_DUPLICADO', motivo: 'external_id repetido no arquivo' }]);
  });
});
