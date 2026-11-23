import { describe, expect, it } from 'vitest';
import type { EntidadeCarga, LinhaCondicaoPagamento, LinhaProdutoUnidade } from '../../contracts';
import { acrescentarIdsDoLote, conferirReferencias, idsVazios, separarDuplicados } from './referencias';

const unidade = (linha: number, produto: string): LinhaProdutoUnidade => ({
  linha, external_id: `U${linha}`, avisos: [], dados: { unidade: 'CX', fator: 120_000 }, refs: { produto },
});

describe('RF-CAD-11: entidade_faltante no CARGA_DEPENDENCIA', () => {
  const cliente = (refs: Record<string, string>) => ({ linha: 2, external_id: 'C1', avisos: [], dados: {}, refs }) as never;
  const semArquivos = new Set<EntidadeCarga>(['cliente']);
  it('RF-CAD-11: tabela_preco_external_id aponta para preco (o arquivo da tabela)', () => {
    expect(conferirReferencias('cliente', [cliente({ tabela_preco: 'T9' })], idsVazios(), semArquivos).erros[0]).toMatchObject({ campo: 'tabela_preco_external_id', entidade_faltante: 'preco' });
  });
  it('T-0058: condicao_pagamento_external_id aponta para condicao_pagamento (a forma não é mais um arquivo)', () => {
    expect(conferirReferencias('cliente', [cliente({ condicao_pagamento: 'X9' })], idsVazios(), semArquivos).erros[0]).toMatchObject({ campo: 'condicao_pagamento_external_id', entidade_faltante: 'condicao_pagamento', motivo: 'Faltam condições de pagamento: carregue condicoes_pagamento.csv antes.' });
  });
  it('RF-CAD-11: CARGA_REFERENCIA não leva entidade_faltante', () => {
    expect(conferirReferencias('produto_unidade', [unidade(2, 'P9')], idsVazios()).erros[0]).not.toHaveProperty('entidade_faltante');
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
      { linha: 4, campo: 'produto_external_id', codigo: 'CARGA_REFERENCIA', motivo: 'Referência não encontrada no banco nem neste lote' },
    ]);
  });
  it('D13: arquivo recusado não entra em idsDoLote, então quem dependia dele cai em CARGA_REFERENCIA', () => {
    const r = conferirReferencias('produto_unidade', [unidade(2, 'P1')], idsVazios());
    expect(r.erros[0]?.codigo).toBe('CARGA_REFERENCIA');
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
