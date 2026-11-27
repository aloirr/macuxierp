import { describe, expect, it } from 'vitest';
import { externalIdForma } from './canonico';
import { chaveVencedoraDaForma, ehErroDeDependenciaDoHub, prazoProntoParaHub, referenciasADesmarcar, remapearFormaDoPrazo, separarFormasRepetidas } from './forma-unica';
import type { RegistroEspelho } from './mapeamento';

const T = '00000000-0000-4000-8000-0000000000aa';
const reg = (entidade: RegistroEspelho['entidade'], external_id: string, payload: Record<string, unknown>): RegistroEspelho => ({ entidade, external_id, alterado_em: '2026-11-27T20:00:00.000Z', ativo: true, payload, hash: 'h', erp_id: null, fonte_refs: {} });

describe('forma de pagamento única por código (v0.3.26)', () => {
  it('RN-INF-11: com forma já confirmada no Hub para o código, vale a primeira confirmada (por confirmado_em)', () => {
    const v = chaveVencedoraDaForma(T, 'BOLETO', [
      { external_id: 'B', confirmada: true, confirmadaEm: '2026-11-27T10:00:00.000Z' },
      { external_id: 'A', confirmada: true, confirmadaEm: '2026-11-26T10:00:00.000Z' },
      { external_id: externalIdForma(T, '15'), confirmada: false, confirmadaEm: null },
    ]);
    expect(v).toBe('A');
  });
  it('RN-INF-11: sem confirmada, vale a derivada do tPag do código', () => {
    const derivada = externalIdForma(T, '15');
    expect(chaveVencedoraDaForma(T, 'BOLETO', [{ external_id: 'ZZZ', confirmada: false, confirmadaEm: null }, { external_id: derivada, confirmada: false, confirmadaEm: null }])).toBe(derivada);
  });
  it('RN-INF-11: código fora da tabela do tPag e sem confirmada: o menor external_id (determinístico)', () => {
    expect(chaveVencedoraDaForma(T, 'CUSTOM', [{ external_id: 'b', confirmada: false, confirmadaEm: null }, { external_id: 'a', confirmada: false, confirmadaEm: null }])).toBe('a');
    expect(chaveVencedoraDaForma(T, 'CUSTOM', [])).toBeNull();
  });
  it('RN-INF-11: o lote nunca leva duas formas com o mesmo código: a perdedora vira linha inválida forma_codigo_repetido', () => {
    const vencedoras = new Map([['BOLETO', 'A']]);
    const r = separarFormasRepetidas([reg('forma_pagamento', 'A', { codigo: 'BOLETO' }), reg('forma_pagamento', 'B', { codigo: 'BOLETO' }), reg('forma_pagamento', 'C', { codigo: 'PIX' })], vencedoras);
    expect(r.manter.map((x) => x.external_id)).toEqual(['A', 'C']);
    expect(r.repetidas).toEqual([{ external_id: 'B', codigo: 'forma_codigo_repetido', campo: 'codigo' }]);
  });
  it('RN-INF-11: o prazo sempre referencia a forma pela chave vencedora do código', () => {
    const prazo = reg('prazo_pagamento', 'P', { forma_external_id: 'B', codigo: '30' });
    const novo = remapearFormaDoPrazo(prazo, (id) => (id === 'B' ? 'A' : null));
    expect(novo.payload.forma_external_id).toBe('A');
    expect(remapearFormaDoPrazo(prazo, () => null)).toBe(prazo);
  });
});

describe('prazo v2 validado antes de enviar (v0.3.26)', () => {
  const ok = { parcelas_dias: [28, 56], prazo_medio_dias: 42 };
  it('RN-INF-12: parcelas_dias lista de inteiros e prazo médio presente passam', () => {
    expect(prazoProntoParaHub(ok)).toBe(true);
  });
  it('RN-INF-12: texto, lista com não inteiro, lista vazia ou prazo médio ausente não passam', () => {
    expect(prazoProntoParaHub({ ...ok, parcelas_dias: '28/56' })).toBe(false);
    expect(prazoProntoParaHub({ ...ok, parcelas_dias: [28, '56'] })).toBe(false);
    expect(prazoProntoParaHub({ ...ok, parcelas_dias: [] })).toBe(false);
    expect(prazoProntoParaHub({ parcelas_dias: [0] })).toBe(false);
    expect(prazoProntoParaHub({ ...ok, prazo_medio_dias: '42' })).toBe(false);
  });
});

describe('dependência recusada pelo Hub desmarca a confirmação da referência (v0.3.26)', () => {
  it('RN-INF-02: reconhece os códigos de dependência inexistente do Hub', () => {
    for (const c of ['referencia_ausente', 'referencia_inexistente', 'filial_inexistente', 'forma_external_id_inexistente', 'dependencia_inexistente']) expect(ehErroDeDependenciaDoHub(c)).toBe(true);
    for (const c of ['campo_invalido', 'regra_invalida', 'forma_pagamento_codigo_uk']) expect(ehErroDeDependenciaDoHub(c)).toBe(false);
  });
  it('RN-INF-02: com o campo do erro, só a referência daquele campo; sem campo, todas as do dependente', () => {
    const preco = { external_id: 'PR', produto_external_id: 'P1', filial_external_id: 'F1' };
    expect(referenciasADesmarcar('preco', preco, 'filial_external_id')).toEqual([{ alvo: 'filial', chave: 'F1' }]);
    expect(referenciasADesmarcar('preco', preco, null)).toEqual([{ alvo: 'produto', chave: 'P1' }, { alvo: 'filial', chave: 'F1' }]);
    expect(referenciasADesmarcar('filial', { external_id: 'F1' }, null)).toEqual([]);
  });
});
