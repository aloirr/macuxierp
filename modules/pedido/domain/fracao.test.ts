import { describe, expect, it } from 'vitest';
import { verificarFracaoDosItens } from './fracao';
import { decidirRecebimentoFdv } from './validacao';

describe('RN-CAD-17: fração só em KG e M no pedido', () => {
  it('RN-CAD-17: KG e M aceitam fração; UN, CX e L só inteiro', () => {
    expect(verificarFracaoDosItens([{ quantidade: 15_000, unidade_comercial: 'KG' }, { quantidade: 5_000, unidade_comercial: 'M' }])).toEqual([]);
    expect(verificarFracaoDosItens([{ quantidade: 20_000, unidade_comercial: 'UN' }, { quantidade: 10_000, unidade_comercial: 'CX' }])).toEqual([]);
    for (const u of ['UN', 'CX', 'L']) expect(verificarFracaoDosItens([{ quantidade: 15_000, unidade_comercial: u }])).toHaveLength(1);
  });
  it('RN-CAD-17: a violação aponta o código da regra e o campo itens[N].quantidade do item fracionado', () => {
    const v = verificarFracaoDosItens([{ quantidade: 10_000, unidade_comercial: 'UN' }, { quantidade: 10_500, unidade_comercial: 'UN' }]);
    expect(v).toEqual([{ rn: 'RN-CAD-17', campo: 'itens[1].quantidade', mensagem: expect.stringContaining('KG e M') }]);
  });
  it('RN-CAD-17: unidade desconhecida não aceita fração', () => {
    expect(verificarFracaoDosItens([{ quantidade: 15_000, unidade_comercial: undefined }])).toHaveLength(1);
  });

  const retrato = (unidade: string, quantidade: number) => ({
    cliente: { inativo: false },
    filial: { emissora: true, inativo: false },
    condicao_pagamento_id: 'c1',
    condicao: { inativo: false },
    produtos: [{ id: 'p1', inativo: false, unidade_comercial: unidade }],
    itens: [{ sequencia: 1, produto_id: 'p1', quantidade, preco_unitario_centavos: 1000, desconto_centavos: 0 }],
  });
  it('RN-PED-01 e RN-CAD-17: pedido do FDV com fração em UN é recusado como item_incoerente com o motivo da regra', () => {
    expect(decidirRecebimentoFdv(retrato('UN', 15_000))).toEqual({ resultado: 'recusado', codigo: 'item_incoerente', motivo: 'RN-CAD-17: Fração só em KG e M: use quantidade inteira' });
  });
  it('RN-PED-01 e RN-CAD-17: fração em KG entra aprovado', () => {
    expect(decidirRecebimentoFdv(retrato('KG', 15_000))).toEqual({ resultado: 'aprovado' });
  });
});
