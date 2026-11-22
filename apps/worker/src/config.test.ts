import { describe, expect, it } from 'vitest';
import { inteiroDoAmbiente, poolDoWorker } from './config';

describe('poolDoWorker (MACUXIERP_PG_POOL, T-0045 §9)', () => {
  it('sem a variável (ou vazia) usa o padrão 5', () => {
    expect(poolDoWorker({})).toBe(5);
    expect(poolDoWorker({ MACUXIERP_PG_POOL: '' })).toBe(5);
    expect(poolDoWorker({ MACUXIERP_PG_POOL: '  ' })).toBe(5);
  });

  it('aceita de 4 a 50', () => {
    expect(poolDoWorker({ MACUXIERP_PG_POOL: '4' })).toBe(4);
    expect(poolDoWorker({ MACUXIERP_PG_POOL: '50' })).toBe(50);
  });

  it.each(['1', '2', '3', '0', '-1'])('abaixo de 4 (%s) a partida falha com mensagem clara', (v) => {
    expect(() => poolDoWorker({ MACUXIERP_PG_POOL: v })).toThrow(
      'configuração inválida: MACUXIERP_PG_POOL (inteiro de 4 a 50; o trabalho da SEFAZ usa até 3 conexões ao mesmo tempo)',
    );
  });

  it.each(['51', '4.5', 'abc'])('fora da faixa ou não inteiro (%s) falha sem ecoar o valor', (v) => {
    let mensagem = '';
    try {
      poolDoWorker({ MACUXIERP_PG_POOL: v });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toMatch(/^configuração inválida: MACUXIERP_PG_POOL /);
    expect(mensagem).not.toContain(v);
  });
});

describe('inteiroDoAmbiente', () => {
  it('sem motivo, mantém a mensagem curta', () => {
    expect(() => inteiroDoAmbiente({ X: '0' }, 'X', 1, 1, 10)).toThrow('configuração inválida: X (inteiro de 1 a 10)');
    expect(inteiroDoAmbiente({ X: '7' }, 'X', 1, 1, 10)).toBe(7);
  });
});
