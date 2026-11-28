import { describe, expect, it } from 'vitest';
import { ImpostoCalculado, RegraAplicada, TotalImpostoCalculado } from '@macuxierp/fiscal/contracts';
import { ImpostoCalculadoPedido, RegraAplicadaPedido, TotalImpostoCalculadoPedido } from '../contracts';
import { ItemNotaLido } from './leitores';

const item = (p_aliq: number) => ({ sequencia: 1, quantidade: 10_000, valor_centavos: 1000, calc_st: { v_bc: 1000, p_aliq, v_valor: 180 } });

describe('leitor da nota autorizada (RN-FIS-05)', () => {
  it('RN-FIS-05: a alíquota lida tem o mesmo teto do cálculo fiscal (1.000.000 = 100,0000%)', () => {
    expect(ItemNotaLido.safeParse(item(1_000_000)).success).toBe(true);
    expect(ItemNotaLido.safeParse(item(1_000_001)).success).toBe(false);
    expect(ItemNotaLido.safeParse(item(-1)).success).toBe(false);
  });
  it('os grupos de imposto do pedido são os do contrato do fiscal (fonte única, com alias)', () => {
    expect(ImpostoCalculadoPedido).toBe(ImpostoCalculado);
    expect(TotalImpostoCalculadoPedido).toBe(TotalImpostoCalculado);
    expect(RegraAplicadaPedido).toBe(RegraAplicada);
  });
});
