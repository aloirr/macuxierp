import { describe, expect, it } from 'vitest';
import { calcularIpiItem } from './ipi';
import { valorOperacao, valorPorUnidade } from './dinheiro';
import { item, regra } from './fixtures';

const rIpi = (p: Record<string, unknown> = {}) => regra({ cst_ipi: '50', aliquota_ipi: 100000, ...p });

describe('IPI (RF-FIS-02)', () => {
  it('RN-FIS-02: BC do IPI = produto + frete + seguro + outras − desconto', () => {
    expect(valorOperacao(item({ frete_centavos: 10000, seguro_centavos: 1000, outras_despesas_centavos: 2000, desconto_centavos: 8000 }))).toBe(105000);
  });
  it('RN-FIS-02: IPI 10% sobre R$ 1.050,00 (R$ 1.000,00 + frete R$ 50,00) = R$ 105,00', () => {
    const r = calcularIpiItem(item({ frete_centavos: 5000 }), rIpi());
    expect(r).toEqual({ ok: true, v_ipi: 10500, ipi: { cst: '50', c_enq: '999', v_bc: 105000, p_ipi: 100000, v_ipi: 10500 } });
  });
  it('RN-FIS-02: IPI por unidade (×10^4): 10 un × R$ 2,5000 = R$ 25,00 e quantidade fracionada arredonda meio para cima', () => {
    expect(calcularIpiItem(item({ quantidade: 10 }), rIpi({ valor_unidade_ipi: 25000, aliquota_ipi: null }))).toMatchObject({ ok: true, v_ipi: 2500, ipi: { q_unid: 10, v_unid: 25000, v_ipi: 2500 } });
    expect(valorPorUnidade(2.5, 33300)).toBe(833); // R$ 8,325 → 832,5 centavos
  });
  it('RN-FIS-02: alíquota e valor por unidade ao mesmo tempo é regra ambígua (REGRA_INCOMPLETA)', () => {
    expect(calcularIpiItem(item({ quantidade: 2 }), rIpi({ valor_unidade_ipi: 1000 }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: CST de entrada (00..05 e 49) é recusado; 50 e 99 são de saída', () => {
    for (const cst of ['00', '01', '02', '03', '04', '05', '49'])
      expect(calcularIpiItem(item(), rIpi({ cst_ipi: cst }))).toMatchObject({ ok: false, codigo: 'CODIGO_INCOMPATIVEL_REGIME' });
    for (const cst of ['50', '99']) expect(calcularIpiItem(item(), rIpi({ cst_ipi: cst }))).toMatchObject({ ok: true });
  });
  it('RN-FIS-02: CST 51..55 saem só com CST e enquadramento, sem valor', () => {
    for (const cst of ['51', '52', '53', '54', '55'])
      expect(calcularIpiItem(item(), rIpi({ cst_ipi: cst, c_enq: '301' }))).toEqual({ ok: true, v_ipi: 0, ipi: { cst, c_enq: '301' } });
  });
  it('RN-FIS-02: CST 50/99 tributados exigem alíquota ou valor por unidade', () => {
    expect(calcularIpiItem(item(), rIpi({ cst_ipi: '99', aliquota_ipi: null }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularIpiItem(item(), rIpi({ cst_ipi: '99', aliquota_ipi: 50000 }))).toMatchObject({ ok: true, v_ipi: 5000 });
  });
  it('RN-FIS-02: CST de IPI inexistente e desconto maior que o item são erros tipados', () => {
    expect(calcularIpiItem(item(), rIpi({ cst_ipi: '77' }))).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
    expect(calcularIpiItem(item({ desconto_centavos: 200000 }), rIpi())).toMatchObject({ ok: false, codigo: 'BASE_NEGATIVA' });
  });
});
