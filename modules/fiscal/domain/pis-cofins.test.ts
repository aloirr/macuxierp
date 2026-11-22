import { describe, expect, it } from 'vitest';
import { basePisCofins, calcularPisCofinsItem } from './pis-cofins';
import { pisCofinsNoDas } from './regra';
import { item, regra } from './fixtures';

const ctx = (p: Record<string, unknown> = {}) => ({ tributo: 'pis' as const, item: item(), regra: regra(), crt: 3 as const, regime: 'nao_cumulativo' as const, v_icms: 0, ...p });

describe('PIS/COFINS (RF-FIS-02)', () => {
  it('RN-FIS-02: cumulativo 0,65% (PIS) e 3% (COFINS) sobre R$ 1.000,00 = R$ 6,50 e R$ 30,00', () => {
    const c = { regime: 'cumulativo' as const };
    expect(calcularPisCofinsItem(ctx(c))).toMatchObject({ ok: true, v_valor: 650, grupo: { cst: '01', v_bc: 100000, p_aliq: 6500, v_valor: 650 } });
    expect(calcularPisCofinsItem(ctx({ ...c, tributo: 'cofins' }))).toMatchObject({ ok: true, v_valor: 3000 });
  });
  it('RN-FIS-02: não cumulativo 1,65% e 7,6% vêm da regra: R$ 16,50 e R$ 76,00', () => {
    const rg = regra({ aliquota_pis: 16500, aliquota_cofins: 76000 });
    const c = { regra: rg, regime: 'nao_cumulativo' as const };
    expect(calcularPisCofinsItem(ctx(c))).toMatchObject({ ok: true, v_valor: 1650 });
    expect(calcularPisCofinsItem(ctx({ ...c, tributo: 'cofins' }))).toMatchObject({ ok: true, v_valor: 7600 });
  });
  it('RN-FIS-02: BC = produto + frete + seguro + outras − desconto, arredondando meio para cima (105000 × 0,65% = 682,5 → 683)', () => {
    const i = item({ frete_centavos: 5000, outras_despesas_centavos: 2000, desconto_centavos: 2000 });
    expect(basePisCofins(i, false, 0)).toBe(105000);
    expect(calcularPisCofinsItem(ctx({ item: i }))).toMatchObject({ ok: true, v_valor: 683 });
  });
  it('RN-FIS-02: por padrão o ICMS não sai da BC; com excluir_icms_bc (tema 69) sai: (1.000 − 180) × 0,65% = R$ 5,33', () => {
    expect(calcularPisCofinsItem(ctx({ v_icms: 18000 }))).toMatchObject({ ok: true, v_valor: 650 });
    expect(calcularPisCofinsItem(ctx({ v_icms: 18000, regra: regra({ excluir_icms_bc: true }) }))).toMatchObject({ ok: true, v_valor: 533, grupo: { v_bc: 82000 } });
    expect(basePisCofins(item(), true, 999999)).toBe(0);
  });
  it('RN-FIS-02: CST 03 por unidade (4 un × R$ 1,2000 = R$ 4,80) e 04..09 sem valor', () => {
    const r03 = regra({ cst_pis: '03', aliquota_pis: null, valor_unidade_pis: 12000 });
    expect(calcularPisCofinsItem(ctx({ item: item({ quantidade: 4 }), regra: r03 }))).toMatchObject({ ok: true, v_valor: 480, grupo: { q_bc_prod: 4, v_aliq_prod: 12000 } });
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '06' }) }))).toEqual({ ok: true, v_valor: 0, grupo: { cst: '06' } });
  });
  it('RN-FIS-02: CST 01 sem alíquota e CST 03 sem valor por unidade são regra incompleta', () => {
    expect(calcularPisCofinsItem(ctx({ regra: regra({ aliquota_pis: null }) }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '03' }) }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: PIS a R$ 0,1411/L × 10.000 L = R$ 1.411,00 (valor por unidade com 4 casas)', () => {
    const r03 = regra({ cst_pis: '03', aliquota_pis: null, valor_unidade_pis: 1411 });
    expect(calcularPisCofinsItem(ctx({ item: item({ quantidade: 10000 }), regra: r03 }))).toMatchObject({ ok: true, v_valor: 141100, grupo: { q_bc_prod: 10000, v_aliq_prod: 1411 } });
  });
  it('RN-FIS-02: alíquota e valor por unidade ao mesmo tempo é regra ambígua (REGRA_INCOMPLETA)', () => {
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '99', valor_unidade_pis: 1411 }) }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularPisCofinsItem(ctx({ regra: regra({ valor_unidade_pis: 1411 }) }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: CST 49 e 99 calculam se a regra trouxer alíquota; senão saem só com o CST', () => {
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '99' }) }))).toMatchObject({ ok: true, v_valor: 650 });
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '99', aliquota_pis: null }) }))).toEqual({ ok: true, v_valor: 0, grupo: { cst: '99' } });
  });
  it('RN-FIS-02: CST de entrada (50..66, 70..75, 98) é recusado nos dois regimes (o motor cobre só saída)', () => {
    for (const cst of ['50', '56', '60', '66', '70', '75', '98'])
      for (const regime of ['cumulativo', 'nao_cumulativo'] as const)
        expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: cst }), regime }))).toMatchObject({ ok: false, codigo: 'CODIGO_INCOMPATIVEL_REGIME' });
  });
  it('RN-FIS-02: CRT 3 sem regime de PIS/COFINS é erro tipado, não exceção', () => {
    expect(calcularPisCofinsItem(ctx({ regime: undefined }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: pisCofinsNoDas vale para CRT 1, 2 e 4; sem regra sai CST 99 sem valor', () => {
    expect([1, 2, 3, 4].map((crt) => pisCofinsNoDas(crt as 1 | 2 | 3 | 4))).toEqual([true, true, false, true]);
    for (const crt of [1, 2, 4]) expect(calcularPisCofinsItem(ctx({ crt, regime: undefined, regra: null }))).toEqual({ ok: true, v_valor: 0, grupo: { cst: '99' } });
  });
  it('RN-FIS-02: no DAS (CRT 1/2/4) aceita CST 04..09, 49 e 99, sempre sem valor; 01..03 são incompatíveis', () => {
    for (const crt of [1, 2, 4])
      for (const cst of ['04', '05', '06', '07', '08', '09', '49', '99'])
        expect(calcularPisCofinsItem(ctx({ crt, regra: regra({ cst_pis: cst }) }))).toEqual({ ok: true, v_valor: 0, grupo: { cst } });
    for (const cst of ['01', '02', '03']) expect(calcularPisCofinsItem(ctx({ crt: 1, regra: regra({ cst_pis: cst }) }))).toMatchObject({ ok: false, codigo: 'CODIGO_INCOMPATIVEL_CRT' });
  });
  it('RN-FIS-02: regime normal sem regra é erro e CST inexistente não é suportado', () => {
    expect(calcularPisCofinsItem(ctx({ regra: null }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularPisCofinsItem(ctx({ regra: regra({ cst_pis: '10' }) }))).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
  });
});
