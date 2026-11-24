import { describe, expect, it } from 'vitest';
import type { LinhaCondicaoPagamento } from '../../contracts';
import { conferirFormasDoLote } from './condicao-forma';

const cond = (linha: number, dados: LinhaCondicaoPagamento['dados']): LinhaCondicaoPagamento => ({ linha, external_id: `K${linha}`, avisos: [], dados: { codigo: `C${linha}`, prazos_dias: [30], ...dados } });

describe('RN-CAD-09: a forma vem na mesma linha da condição', () => {
  it('RN-CAD-09: a forma é criada pela 1ª linha que a traz e as demais linhas da forma herdam os dados dela', () => {
    const r = conferirFormasDoLote([
      cond(2, { forma_external_id: 'F1', forma_codigo: 'BOLETO', forma_nome: 'Boleto', forma_tpag: '15' }),
      cond(3, { forma_external_id: 'F1' }),
    ]);
    expect(r.erros).toEqual([]);
    expect(r.linhas[1]?.dados).toMatchObject({ forma_external_id: 'F1', forma_codigo: 'BOLETO', forma_nome: 'Boleto', forma_tpag: '15' });
    expect(r.formas).toEqual([{ chave: 'F1', external_id: 'F1', codigo: 'BOLETO', nome: 'Boleto', tpag: '15', linha: 2, condicoes: ['K2', 'K3'] }]);
  });

  it('RN-CAD-09: sem forma_external_id a chave da forma é o forma_codigo (sem diferença de maiúsculas)', () => {
    const r = conferirFormasDoLote([
      cond(2, { forma_codigo: 'PIX', forma_nome: 'PIX', forma_tpag: '17' }),
      cond(3, { forma_codigo: 'pix', forma_nome: 'PIX', forma_tpag: '17' }),
    ]);
    expect(r.erros).toEqual([]);
    expect(r.formas).toHaveLength(1);
    expect(r.formas[0]?.external_id).toBeUndefined();
  });

  it('RN-CAD-09: linha da mesma forma com nome ou tPag diferente sai com erro de texto fixo, sem o valor', () => {
    const r = conferirFormasDoLote([
      cond(2, { forma_external_id: 'F1', forma_codigo: 'BOLETO', forma_nome: 'Boleto', forma_tpag: '15' }),
      cond(3, { forma_external_id: 'F1', forma_nome: 'Boleto SEGREDO' }),
      cond(4, { forma_external_id: 'F1', forma_tpag: '17' }),
    ]);
    expect(r.erros).toEqual([
      { linha: 3, campo: 'forma_nome', codigo: 'CARGA_CONFLITO', motivo: 'Dados da forma diferentes da linha 2: deixe iguais em todas as linhas da forma' },
      { linha: 4, campo: 'forma_tpag', codigo: 'CARGA_CONFLITO', motivo: 'Dados da forma diferentes da linha 2: deixe iguais em todas as linhas da forma' },
    ]);
    expect(r.linhas.map((l) => l.linha)).toEqual([2]);
  });

  it('RN-CAD-09: linha sem forma passa sem mexer (a criação cobra a forma)', () => {
    const r = conferirFormasDoLote([cond(2, {})]);
    expect(r.erros).toEqual([]);
    expect(r.formas).toEqual([]);
    expect(r.linhas).toHaveLength(1);
  });
});
