import { describe, expect, it } from 'vitest';
import { conferirRegra63A, impostosDaNota, type ItemNotaFiscal } from './impostos-nota';

const st = (v_bc: number, p_aliq: number, v_valor: number) => ({ v_bc, p_aliq, v_valor });
const comTudo = (seq: number): ItemNotaFiscal => ({
  sequencia: seq, regra_aplicada: { st: true, ipi: true }, calc_st: st(1000, 180000, 180), calc_ipi: st(500, 50000, 25),
});

describe('RN-FIS-05 (regra 63 A) no faturado do pedido', () => {
  it('RN-FIS-05: item com regra leva regra_aplicada e calc_*; o total soma só os itens da nota', () => {
    const r = impostosDaNota([comTudo(1), comTudo(2)]);
    expect(r.itens[0]).toEqual({ sequencia: 1, regra_aplicada: { st: true, ipi: true }, calc_st: st(1000, 180000, 180), calc_ipi: st(500, 50000, 25) });
    expect(r.total).toEqual({ calc_st: { v_bc: 2000, v_valor: 360 }, calc_ipi: { v_bc: 1000, v_valor: 50 } });
  });
  it('RN-FIS-05: zero COM regra é legítimo e entra no total', () => {
    const r = impostosDaNota([{ sequencia: 1, regra_aplicada: { st: true, ipi: false }, calc_st: st(0, 180000, 0) }]);
    expect(r.total).toEqual({ calc_st: { v_bc: 0, v_valor: 0 } });
  });
  it('RN-FIS-05: item sem regra_aplicada (emissor antigo) é sem regra: omite tudo e o total some', () => {
    const r = impostosDaNota([comTudo(1), { sequencia: 2, calc_st: st(1, 1, 1) }]);
    expect(r.itens[1]).toEqual({ sequencia: 2 });
    expect(r.total).toEqual({});
  });
  it('RN-FIS-05: item misto (só ST) omite o total do IPI e mantém o do ST', () => {
    const r = impostosDaNota([comTudo(1), { sequencia: 2, regra_aplicada: { st: true, ipi: false }, calc_st: st(100, 180000, 18) }]);
    expect(r.itens[1]).toEqual({ sequencia: 2, regra_aplicada: { st: true, ipi: false }, calc_st: st(100, 180000, 18) });
    expect(r.total).toEqual({ calc_st: { v_bc: 1100, v_valor: 198 } });
  });
  it('RN-FIS-05: regra_aplicada true sem o calc_* correspondente conta como sem regra, sem inventar valor', () => {
    const r = impostosDaNota([{ sequencia: 1, regra_aplicada: { st: true, ipi: true }, calc_st: st(1, 1, 1) }]);
    expect(r.itens[0]).toEqual({ sequencia: 1, regra_aplicada: { st: true, ipi: false }, calc_st: st(1, 1, 1) });
    expect(r.total).toEqual({ calc_st: { v_bc: 1, v_valor: 1 } });
  });
  it('RN-FIS-05: calc_* com regra_aplicada false é descartado', () => {
    const r = impostosDaNota([{ sequencia: 1, regra_aplicada: { st: false, ipi: false }, calc_st: st(1, 1, 1), calc_ipi: st(1, 1, 1) }]);
    expect(r.itens[0]).toEqual({ sequencia: 1, regra_aplicada: { st: false, ipi: false } });
    expect(r.total).toEqual({});
  });
  it('RN-FIS-05: nota parcial: total só dos itens faturados, omitido se algum deles não tem regra', () => {
    expect(impostosDaNota([comTudo(3)]).total.calc_st).toEqual({ v_bc: 1000, v_valor: 180 });
    expect(impostosDaNota([{ sequencia: 3 }]).total).toEqual({});
    expect(impostosDaNota([]).total).toEqual({});
  });
  it('RN-FIS-05: conferirRegra63A aceita a saída de impostosDaNota e acusa total sem todos os itens com regra', () => {
    const ok = impostosDaNota([comTudo(1), { sequencia: 2 }]);
    expect(conferirRegra63A(ok.itens, ok.total)).toEqual([]);
    expect(conferirRegra63A(ok.itens, { calc_st: { v_bc: 1, v_valor: 1 } })).toEqual(['total_calc_st_sem_todos_com_regra']);
    expect(conferirRegra63A([{ sequencia: 1, calc_ipi: st(1, 1, 1) }], {})).toEqual(['item_1_calc_ipi_sem_regra']);
    expect(conferirRegra63A([{ sequencia: 1, regra_aplicada: { st: true, ipi: false } }], {})).toEqual(['item_1_calc_st_ausente_com_regra', 'total_calc_st_ausente']);
  });
});
