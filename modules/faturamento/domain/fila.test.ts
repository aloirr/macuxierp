import { describe, expect, it } from 'vitest';
import { statusDaFila } from './fila';

const item = (sequencia: number, quantidade: number, quantidade_faturada: number) => ({ sequencia, quantidade, quantidade_faturada });

describe('situação do pedido → status da fila a faturar', () => {
  it('RF-FAT-01: pedido cancelado vira cancelado', () => {
    expect(statusDaFila({ status: 'cancelado', itens: [item(1, 10_000, 0)] })).toBe('cancelado');
  });
  it('RF-FAT-01: sem saldo em nenhum item vira faturado', () => {
    expect(statusDaFila({ status: 'faturado', itens: [item(1, 10_000, 10_000), item(2, 5_000, 5_000)] })).toBe('faturado');
  });
  it('RF-FAT-01: saldo parcial (algum item já faturado e ainda há saldo) vira faturado_parcial', () => {
    expect(statusDaFila({ status: 'faturado_parcial', itens: [item(1, 10_000, 10_000), item(2, 5_000, 0)] })).toBe('faturado_parcial');
    expect(statusDaFila({ status: 'aprovado', itens: [item(1, 10_000, 4_000)] })).toBe('faturado_parcial');
  });
  it('RF-FAT-01: sem nada faturado, ou sem situação, fica a_faturar', () => {
    expect(statusDaFila({ status: 'aprovado', itens: [item(1, 10_000, 0)] })).toBe('a_faturar');
    expect(statusDaFila(null)).toBe('a_faturar');
  });
});
