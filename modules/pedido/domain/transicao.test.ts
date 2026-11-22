import { describe, expect, it } from 'vitest';
import { StatusPedido } from '../contracts';
import { TERMINAIS, TRANSICOES, possiveis, validarTransicao } from './transicao';

const TODOS = StatusPedido.options;

describe('máquina de status do pedido', () => {
  it('RN-PED-02: recebido vai a aprovado ou em_analise', () => {
    expect(possiveis('recebido')).toEqual(['aprovado', 'em_analise']);
    expect(validarTransicao('recebido', 'aprovado')).toEqual({ ok: true });
  });

  it('RN-PED-02: em_analise vai a aprovado ou recusado', () => {
    expect(possiveis('em_analise')).toEqual(['aprovado', 'recusado']);
  });

  it('RN-PED-02: aprovado vai a faturado_parcial, faturado ou cancelado; faturado_parcial a faturado ou cancelado', () => {
    expect(possiveis('aprovado')).toEqual(['faturado_parcial', 'faturado', 'cancelado']);
    expect(possiveis('faturado_parcial')).toEqual(['faturado', 'cancelado']);
  });

  it('RN-PED-02: recusado, faturado e cancelado são terminais', () => {
    expect([...TERMINAIS].sort()).toEqual(['cancelado', 'faturado', 'recusado']);
    for (const t of TERMINAIS) expect(possiveis(t)).toEqual([]);
  });

  it('RN-PED-02: todo par fora da tabela é recusado com a lista do que é possível', () => {
    for (const de of TODOS) {
      for (const para of TODOS) {
        const r = validarTransicao(de, para);
        if (TRANSICOES[de].includes(para)) expect(r).toEqual({ ok: true });
        else expect(r).toEqual({ ok: false, rn: 'RN-PED-02', de, para, possiveis: TRANSICOES[de], mensagem: expect.any(String) });
      }
    }
  });

  it('RN-PED-02: em_analise para em_analise não é transição (é revalidação)', () => {
    expect(validarTransicao('em_analise', 'em_analise').ok).toBe(false);
  });
});
