import { describe, expect, it } from 'vitest';
import type { ItemCalculo } from '../contracts';
import { aliquotaInterestadual, baseIcms, calcularIcms, calcularIcmsItem, calcularIcmsSt, mvaAjustada } from './icms';
import { item, regra } from './fixtures';

describe('calcularIcms', () => {
  it('RN-FIS-02: operação interna a 18% sobre R$ 1.000,00 dá vICMS R$ 180,00', () => {
    expect(calcularIcms({ base_centavos: 100000, reducao_bc: null, aliquota: 180000 })).toEqual({ v_bc: 100000, v_icms: 18000 });
  });
  it('RN-FIS-02: alíquota vem da regra, sem UF fixa no código (AM a 20% = R$ 200,00)', () => {
    expect(calcularIcms({ base_centavos: 100000, reducao_bc: null, aliquota: 200000 }).v_icms).toBe(20000);
  });
  it('RN-FIS-02: BC = produto + frete + seguro + outras − desconto', () => {
    expect(baseIcms(item({ frete_centavos: 10000, seguro_centavos: 1000, outras_despesas_centavos: 2000, desconto_centavos: 8000 }), false)).toBe(105000);
  });
  it('RN-FIS-02: IPI entra na BC do próprio só quando pedido (consumidor final/não contribuinte)', () => {
    const i = item({ ipi_centavos: 10000 });
    expect(baseIcms(i, true)).toBe(110000);
    expect(baseIcms(i, false)).toBe(100000);
  });
  it('RN-FIS-02: redução de BC de 33,33% leva a BC a R$ 666,70 e o ICMS a R$ 120,01 (meio para cima)', () => {
    expect(calcularIcms({ base_centavos: 100000, reducao_bc: 333300, aliquota: 180000 })).toEqual({ v_bc: 66670, v_icms: 12001 });
  });
  it('RN-FIS-02: arredondamento meio para cima ao centavo, em inteiros', () => {
    // 1,25 × 10% = 0,125 -> 0,13 ; 1,24 × 10% = 0,124 -> 0,12
    expect(calcularIcms({ base_centavos: 125, reducao_bc: null, aliquota: 100000 }).v_icms).toBe(13);
    expect(calcularIcms({ base_centavos: 124, reducao_bc: null, aliquota: 100000 }).v_icms).toBe(12);
  });
  it('RN-FIS-02: valores muito altos não perdem precisão', () => {
    expect(calcularIcms({ base_centavos: 9_000_000_000_000, reducao_bc: null, aliquota: 180000 }).v_icms).toBe(1_620_000_000_000);
  });
});

describe('alíquota interestadual', () => {
  it('RN-FIS-02: origem 1, 2, 3 e 8 usam 4% (Resolução do Senado 13/2012)', () => {
    for (const o of ['1', '2', '3', '8']) expect(aliquotaInterestadual(o, 120000)).toBe(40000);
    for (const o of ['0', '4', '5', '6', '7']) expect(aliquotaInterestadual(o, 120000)).toBe(120000);
  });
});

describe('calcularIcmsSt e MVA ajustada', () => {
  it('RN-FIS-02: MVA ajustada = [(1+40%)×(1−12%)/(1−18%)]−1 = 50,2439%', () => {
    expect(mvaAjustada(400000, 120000, 180000)).toBe(502439);
  });
  it('RN-FIS-02: ST interno com MVA 40%: BC ST 1.400,00; ST = 252,00 − 180,00 = 72,00', () => {
    expect(calcularIcmsSt({ base_centavos: 100000, mva: 400000, reducao_bc_st: null, aliquota_st: 180000, v_icms_proprio: 18000 })).toEqual({ v_bc_st: 140000, v_icms_st: 7200 });
  });
  it('RN-FIS-02: ST com MVA 50,24%: BC ST 1.502,40; ST = 270,43 − 120,00 = 150,43', () => {
    expect(calcularIcmsSt({ base_centavos: 100000, mva: 502400, reducao_bc_st: null, aliquota_st: 180000, v_icms_proprio: 12000 })).toEqual({ v_bc_st: 150240, v_icms_st: 15043 });
  });
  it('RN-FIS-02: redução da BC do ST e ST nunca negativo', () => {
    expect(calcularIcmsSt({ base_centavos: 100000, mva: 400000, reducao_bc_st: 100000, aliquota_st: 180000, v_icms_proprio: 0 }).v_bc_st).toBe(126000);
    expect(calcularIcmsSt({ base_centavos: 100000, mva: null, reducao_bc_st: null, aliquota_st: 100000, v_icms_proprio: 50000 }).v_icms_st).toBe(0);
  });
});

describe('MVA ajustada: casos limite (Conv. ICMS 142/2018)', () => {
  it('RN-FIS-02: ALQ intra <= ALQ inter usa a MVA original, nunca negativa', () => {
    expect(mvaAjustada(400000, 120000, 120000)).toBe(400000);
    expect(mvaAjustada(400000, 120000, 70000)).toBe(400000);
    expect(mvaAjustada(0, 120000, 70000)).toBe(0);
  });
  it('RN-FIS-02: ALQ intra de 100% não divide por zero', () => {
    expect(mvaAjustada(400000, 120000, 1_000_000)).toBe(400000);
  });
});

describe('alíquotas fracionárias (4 casas)', () => {
  it('RN-FIS-02: ICMS a 17,5000% sobre R$ 3,33 = 0,58275 -> R$ 0,58', () => {
    expect(calcularIcms({ base_centavos: 333, reducao_bc: null, aliquota: 175000 })).toEqual({ v_bc: 333, v_icms: 58 });
  });
  it('RN-FIS-02: MVA ajustada a 4 casas: [(1,40)×(0,88)/(0,825)]−1 = 49,3333%', () => {
    expect(mvaAjustada(400000, 120000, 175000)).toBe(493333);
  });
  it('RN-FIS-02: ST com MVA 49,3333% e alíquota 17,5000%: BC ST 1.493,33; ST = 261,33 − 120,00 = 141,33', () => {
    expect(calcularIcmsSt({ base_centavos: 100000, mva: 493333, reducao_bc_st: null, aliquota_st: 175000, v_icms_proprio: 12000 })).toEqual({ v_bc_st: 149333, v_icms_st: 14133 });
  });
  it('RN-FIS-02: redução de BC com 4 casas (33,3333%) leva R$ 1.000,00 a R$ 666,67', () => {
    expect(calcularIcms({ base_centavos: 100000, reducao_bc: 333333, aliquota: 180000 }).v_bc).toBe(66667);
  });
});

describe('calcularIcmsItem por código', () => {
  const ctx = (r: Parameters<typeof regra>[0], i: Partial<ItemCalculo> = {}, interestadual = false, ipi_na_bc = false) => ({ item: item(i), regra: regra(r), interestadual, ipi_na_bc });

  it('RN-FIS-02: CST 00 interno a 18%', () => {
    const r = calcularIcmsItem(ctx({ codigo: '00' }));
    expect(r).toMatchObject({ ok: true, icms: { orig: '0', cst: '00', mod_bc: 3, v_bc: 100000, p_icms: 180000, v_icms: 18000 } });
  });
  it('RN-FIS-02: interestadual AM→SP a 12% da regra', () => {
    const r = calcularIcmsItem(ctx({ codigo: '00', aliquota_icms: 120000 }, {}, true));
    expect(r).toMatchObject({ ok: true, icms: { p_icms: 120000, v_icms: 12000 } });
  });
  it('RN-FIS-02: importado (origem 1) interestadual usa 4% mesmo com 12% na regra; interno não', () => {
    expect(calcularIcmsItem(ctx({ aliquota_icms: 120000 }, { origem: '1' }, true))).toMatchObject({ ok: true, icms: { p_icms: 40000, v_icms: 4000 } });
    expect(calcularIcmsItem(ctx({ aliquota_icms: 180000 }, { origem: '1' }, false))).toMatchObject({ ok: true, icms: { p_icms: 180000, v_icms: 18000 } });
  });
  it('RN-FIS-02: CST 20 com redução de BC', () => {
    expect(calcularIcmsItem(ctx({ codigo: '20', reducao_bc: 333300 }))).toMatchObject({ ok: true, icms: { p_red_bc: 333300, v_bc: 66670, v_icms: 12001 } });
  });
  it('RN-FIS-02: CST 10 interestadual com MVA ajustada pela fórmula (50,2439%)', () => {
    const r = calcularIcmsItem(ctx({ codigo: '10', aliquota_icms: 120000, mva_original: 400000, ajustar_mva: true, aliquota_interna_destino: 180000 }, {}, true));
    expect(r).toMatchObject({ ok: true, icms: { v_icms: 12000, mod_bc_st: 4, p_mva_st: 502439, v_bc_st: 150244, p_icms_st: 180000, v_icms_st: 15044 } });
  });
  it('RN-FIS-02: CST 10 interno usa a MVA original (sem ajuste)', () => {
    const r = calcularIcmsItem(ctx({ codigo: '10', mva_original: 400000, ajustar_mva: true, aliquota_interna_destino: 180000 }));
    expect(r).toMatchObject({ ok: true, icms: { p_mva_st: 400000, v_bc_st: 140000, v_icms_st: 7200 } });
  });
  it('RN-FIS-02: MVA ajustada cadastrada na regra vale na interestadual', () => {
    const r = calcularIcmsItem(ctx({ codigo: '10', aliquota_icms: 120000, mva_original: 400000, mva_ajustada: 500000, aliquota_interna_destino: 180000 }, {}, true));
    expect(r).toMatchObject({ ok: true, icms: { p_mva_st: 500000, v_bc_st: 150000 } });
  });
  it('RN-FIS-02: IPI entra na BC do ST sempre e na do próprio conforme o destinatário', () => {
    const r = calcularIcmsItem(ctx({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000 }, { ipi_centavos: 10000 }, false, false));
    expect(r).toMatchObject({ ok: true, icms: { v_bc: 100000, v_bc_st: 154000 } });
    const r2 = calcularIcmsItem(ctx({ codigo: '00' }, { ipi_centavos: 10000 }, false, true));
    expect(r2).toMatchObject({ ok: true, icms: { v_bc: 110000, v_icms: 19800 } });
  });
  it('RN-FIS-02: FCP e FCP-ST somam ao grupo; vFCPST = BC ST × pFCPST − vFCP próprio', () => {
    // Conferido à mão: BC 1.000,00 × 2% = vFCP 20,00; BC ST 1.400,00 × 2% = 28,00; vFCPST = 28,00 − 20,00 = 8,00.
    // Premissa: o abatimento do FCP próprio segue a NT 2016.002; confirmar com a UF.
    const r = calcularIcmsItem(ctx({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000, p_fcp: 20000, p_fcp_st: 20000 }));
    expect(r).toMatchObject({ ok: true, icms: { p_fcp: 20000, v_fcp: 2000, v_bc_fcp_st: 140000, p_fcp_st: 20000, v_fcp_st: 800 } });
  });
  it('RN-FIS-02: CSOSN 201/202/203 também trazem FCP-ST (NT 2016.002), sem FCP próprio a abater', () => {
    // BC ST 1.400,00 × 2% = 28,00. Premissa: confirmar com a UF.
    for (const codigo of ['201', '202', '203']) {
      const r = calcularIcmsItem(ctx({ codigo, mva_original: 400000, aliquota_interna_destino: 180000, aliquota_icms: 180000, p_fcp_st: 20000, p_cred_sn: codigo === '201' ? 28200 : null }));
      expect(r).toMatchObject({ ok: true, icms: { v_bc_fcp_st: 140000, p_fcp_st: 20000, v_fcp_st: 2800 } });
    }
  });
  it('RN-FIS-02: vFCPST nunca fica negativo', () => {
    const r = calcularIcmsItem(ctx({ codigo: '10', mva_original: 0, aliquota_interna_destino: 180000, p_fcp: 40000, p_fcp_st: 10000 }));
    expect(r).toMatchObject({ ok: true, icms: { v_fcp: 4000, v_fcp_st: 0 } });
  });
  it('RN-FIS-02: desconto maior que o valor bruto é erro, mesmo com frete cobrindo a base', () => {
    expect(calcularIcmsItem(ctx({ codigo: '00' }, { desconto_centavos: 100001, frete_centavos: 50000 }))).toMatchObject({ ok: false, codigo: 'BASE_NEGATIVA' });
    expect(calcularIcmsItem(ctx({ codigo: '40' }, { desconto_centavos: 100001 }))).toMatchObject({ ok: false, codigo: 'BASE_NEGATIVA' });
  });
  it('RN-FIS-06: intraestadual a não contribuinte não gera DIFAL', () => {
    const c = { ...ctx({ codigo: '00', aliquota_icms: 120000 }, {}, true), destinatario_nao_contribuinte_final: true };
    expect(calcularIcmsItem({ ...c, interestadual: false })).toMatchObject({ ok: true });
    expect(calcularIcmsItem({ ...c, interestadual: false })).not.toHaveProperty('icms_uf_dest');
  });
  it('RN-FIS-02: CST 30 tem ST sem ICMS próprio', () => {
    expect(calcularIcmsItem(ctx({ codigo: '30', mva_original: 400000, aliquota_interna_destino: 180000 }))).toMatchObject({ ok: true, icms: { v_bc_st: 140000, v_icms_st: 25200 } });
  });
  it('RN-FIS-02: CST 40, 41, 50 e 60 não calculam nada', () => {
    for (const codigo of ['40', '41', '50', '60']) {
      const r = calcularIcmsItem(ctx({ codigo }));
      expect(r).toEqual({ ok: true, icms: { orig: '0', cst: codigo } });
    }
  });
  it('RN-FIS-02: CSOSN 101 com crédito de 2,82%: vCredICMSSN = R$ 28,20', () => {
    const r = calcularIcmsItem(ctx({ codigo: '101', p_cred_sn: 28200 }));
    expect(r).toEqual({ ok: true, icms: { orig: '0', csosn: '101', p_cred_sn: 28200, v_cred_icms_sn: 2820 } });
  });
  it('RN-FIS-02: CSOSN 101 sem pCredSN na regra é regra incompleta', () => {
    expect(calcularIcmsItem(ctx({ codigo: '101' }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: CSOSN 201 com ST (MVA 40%) abate o ICMS nominal e leva crédito', () => {
    const r = calcularIcmsItem(ctx({ codigo: '201', mva_original: 400000, aliquota_interna_destino: 180000, aliquota_icms: 180000, p_cred_sn: 28200 }));
    expect(r).toMatchObject({ ok: true, icms: { csosn: '201', v_bc_st: 140000, v_icms_st: 7200, v_cred_icms_sn: 2820 } });
  });
  it('RN-FIS-02: CSOSN 202 tem ST sem crédito; 102, 103, 300, 400 e 500 não calculam', () => {
    const r = calcularIcmsItem(ctx({ codigo: '202', mva_original: 400000, aliquota_interna_destino: 180000, aliquota_icms: 180000 }));
    expect(r).toMatchObject({ ok: true, icms: { v_icms_st: 7200 } });
    expect((r as { icms: object }).icms).not.toHaveProperty('v_cred_icms_sn');
    for (const codigo of ['102', '103', '300', '400', '500']) expect(calcularIcmsItem(ctx({ codigo }))).toEqual({ ok: true, icms: { orig: '0', csosn: codigo } });
  });
  it('RN-FIS-02: desconto maior que o item dá erro de base negativa', () => {
    expect(calcularIcmsItem(ctx({ codigo: '00' }, { desconto_centavos: 200000 }))).toMatchObject({ ok: false, codigo: 'BASE_NEGATIVA' });
  });
  it('RN-FIS-02: CST 51 sem pDif é regra incompleta (não é mais código não suportado)', () => {
    expect(calcularIcmsItem(ctx({ codigo: '51' }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-02: CST 10 sem alíquota interna do destino é regra incompleta', () => {
    expect(calcularIcmsItem(ctx({ codigo: '10', mva_original: 400000 }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
});

describe('CST 51 (diferimento)', () => {
  const ctx = (r: Parameters<typeof regra>[0], i: Partial<ItemCalculo> = {}) => ({ item: item(i), regra: regra({ codigo: '51', ...r }), interestadual: false, ipi_na_bc: false });
  it('RN-FIS-02: 100% diferido: vICMSOp 180,00, vICMSDif 180,00, vICMS 0', () => {
    expect(calcularIcmsItem(ctx({ p_dif: 1000000 }))).toEqual({
      ok: true,
      icms: { orig: '0', cst: '51', mod_bc: 3, v_bc: 100000, p_icms: 180000, v_icms_op: 18000, p_dif: 1000000, v_icms_dif: 18000, v_icms: 0 },
    });
  });
  it('RN-FIS-02: 33,33% diferido: 180,00 × 0,3333 = 59,994 -> 59,99; vICMS = 120,01', () => {
    expect(calcularIcmsItem(ctx({ p_dif: 333300 }))).toMatchObject({ ok: true, icms: { v_icms_op: 18000, p_dif: 333300, v_icms_dif: 5999, v_icms: 12001 } });
  });
  it('RN-FIS-02: diferimento parcial de 50% e redução de BC de 33,33%: vBC 666,70, vICMSOp 120,01, dif 60,01 (meio para cima), vICMS 60,00', () => {
    expect(calcularIcmsItem(ctx({ p_dif: 500000, reducao_bc: 333300 }))).toMatchObject({ ok: true, icms: { p_red_bc: 333300, v_bc: 66670, v_icms_op: 12001, v_icms_dif: 6001, v_icms: 6000 } });
  });
  it('RN-FIS-02: CST 51 com FCP (FCP diferido) é CODIGO_NAO_SUPORTADO até conferir a NT 2016.002 / homologação T-0046', () => {
    expect(calcularIcmsItem(ctx({ p_dif: 500000, p_fcp: 20000 }))).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: expect.stringContaining('T-0046') });
  });
  it('RN-FIS-02: CST 51 sem alíquota de ICMS é regra incompleta', () => {
    expect(calcularIcmsItem(ctx({ p_dif: 500000, aliquota_icms: null }))).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
});

describe('ICMS-ST retido anteriormente (CST 60 e CSOSN 500)', () => {
  const st = { v_bc_st_ret: 140000, p_st: 180000, v_icms_substituto: 18000, v_icms_st_ret: 7200 };
  const ctx = (codigo: string, i: Partial<ItemCalculo> = {}, extra: Record<string, unknown> = {}) => ({ item: item(i), regra: regra({ codigo, ...(extra as object) }), interestadual: false, ipi_na_bc: false });
  it('RN-FIS-02: CST 60 com st_retido devolve vBCSTRet, pST, vICMSSubstituto e vICMSSTRet', () => {
    expect(calcularIcmsItem(ctx('60', { st_retido: st }))).toEqual({ ok: true, icms: { orig: '0', cst: '60', v_bc_st_ret: 140000, p_st: 180000, v_icms_substituto: 18000, v_icms_st_ret: 7200 } });
  });
  it('RN-FIS-02: CSOSN 500 com st_retido e FCP-ST retido', () => {
    const r = calcularIcmsItem(ctx('500', { st_retido: { ...st, v_bc_fcp_st_ret: 140000, p_fcp_st_ret: 20000, v_fcp_st_ret: 2800 } }));
    expect(r).toEqual({
      ok: true,
      icms: { orig: '0', csosn: '500', v_bc_st_ret: 140000, p_st: 180000, v_icms_substituto: 18000, v_icms_st_ret: 7200, v_bc_fcp_st_ret: 140000, p_fcp_st_ret: 20000, v_fcp_st_ret: 2800 },
    });
  });
  it('RN-FIS-02: sem st_retido o 60 e o 500 saem sem os campos de ST retido (opcionais no leiaute)', () => {
    expect(calcularIcmsItem(ctx('60'))).toEqual({ ok: true, icms: { orig: '0', cst: '60' } });
    expect(calcularIcmsItem(ctx('500'))).toEqual({ ok: true, icms: { orig: '0', csosn: '500' } });
  });
  it('RN-FIS-02: FCP-ST retido pela metade (só um dos três campos) é entrada inválida', () => {
    expect(calcularIcmsItem(ctx('60', { st_retido: { ...st, v_fcp_st_ret: 2800 } }))).toMatchObject({ ok: false, codigo: 'ENTRADA_INVALIDA' });
  });
  it('RN-FIS-02: vICMSSTRet maior que vBCSTRet é incoerente (entrada inválida)', () => {
    expect(calcularIcmsItem(ctx('60', { st_retido: { ...st, v_icms_st_ret: 140001 } }))).toMatchObject({ ok: false, codigo: 'ENTRADA_INVALIDA', mensagem: expect.stringContaining('ST retido incoerente') });
  });
  it('RN-FIS-02: ICMS efetivo (consumidor final, p_icms_efet na regra): 1.000,00 × (1 − 10%) = 900,00 × 18% = 162,00', () => {
    const r = calcularIcmsItem({ ...ctx('60', { st_retido: { ...st, p_red_bc_efet: 100000 } }, { p_icms_efet: 180000 }), consumidor_final: true });
    expect(r).toMatchObject({ ok: true, icms: { p_red_bc_efet: 100000, v_bc_efet: 90000, p_icms_efet: 180000, v_icms_efet: 16200 } });
  });
  it('RN-FIS-02: ICMS efetivo sem redução usa pRedBCEfet 0 e o valor da operação (com frete e desconto)', () => {
    const r = calcularIcmsItem({ ...ctx('500', { st_retido: st, frete_centavos: 5000, desconto_centavos: 2000 }, { p_icms_efet: 180000 }), consumidor_final: true });
    expect(r).toMatchObject({ ok: true, icms: { p_red_bc_efet: 0, v_bc_efet: 103000, v_icms_efet: 18540 } });
  });
  it('RN-FIS-02: sem consumidor final ou sem p_icms_efet na regra, não há ICMS efetivo', () => {
    for (const c of [ctx('60', { st_retido: st }, { p_icms_efet: 180000 }), { ...ctx('60', { st_retido: st }), consumidor_final: true }]) {
      const r = calcularIcmsItem(c);
      expect(r).toMatchObject({ ok: true });
      expect((r as { icms: object }).icms).not.toHaveProperty('v_bc_efet');
    }
  });
  it('RN-FIS-02: st_retido é ignorado fora do CST 60 e do CSOSN 500', () => {
    expect((calcularIcmsItem(ctx('00', { st_retido: st })) as { icms: object }).icms).not.toHaveProperty('v_bc_st_ret');
  });
});

describe('CSOSN 900 sem pCredSN (caso do MEI)', () => {
  const ctx = (r: Parameters<typeof regra>[0]) => ({ item: item(), regra: regra({ codigo: '900', p_cred_sn: null, ...r }), interestadual: false, ipi_na_bc: false });
  it('RN-FIS-02: 900 sem pCredSN e sem alíquota sai só com orig e CSOSN', () => {
    expect(calcularIcmsItem(ctx({ aliquota_icms: null }))).toEqual({ ok: true, icms: { orig: '0', csosn: '900' } });
  });
  it('RN-FIS-02: 900 sem pCredSN e com alíquota não gera crédito do Simples', () => {
    const r = calcularIcmsItem(ctx({}));
    expect(r).toMatchObject({ ok: true });
    expect((r as { icms: object }).icms).not.toHaveProperty('v_cred_icms_sn');
  });
});

describe('ST: recusas até existir pauta e ajuste explícito da MVA (RN-FIS-05)', () => {
  // `forcar` entra depois do parse do schema (que não aceita ajustar_mva nulo): simula o chamador que não passou pelo contrato.
  const rodar = (r: Record<string, unknown>, interestadual = false, forcar: Record<string, unknown> = {}) =>
    calcularIcmsItem({ item: item(), regra: { ...regra({ codigo: '10', aliquota_icms: 120000, mva_original: 400000, aliquota_interna_destino: 180000, ...r }), ...forcar } as ReturnType<typeof regra>, interestadual, ipi_na_bc: false });
  it('RN-FIS-05: modBCST 0..3 e 5 (pauta, preço tabelado, lista) é recusado com CODIGO_NAO_SUPORTADO; 4 e não informado calculam por MVA', () => {
    for (const m of [0, 1, 2, 3, 5]) expect(rodar({ mod_bc_st: m, mva_original: null })).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
    expect(rodar({ mod_bc_st: 4 })).toMatchObject({ ok: true, icms: { mod_bc_st: 4, v_bc_st: 140000 } });
    expect(rodar({})).toMatchObject({ ok: true, icms: { mod_bc_st: 4 } });
  });
  it('RN-FIS-05: interestadual com ajustar_mva nulo/ausente e sem MVA ajustada é CODIGO_NAO_SUPORTADO (fail-closed, sem default); false explícito segue com a MVA original', () => {
    expect(rodar({}, true, { ajustar_mva: null })).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
    expect(rodar({}, true, { ajustar_mva: undefined })).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
    expect(rodar({ ajustar_mva: null }, true)).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
    expect(rodar({ ajustar_mva: null }, false)).toMatchObject({ ok: true }); // intraestadual não ajusta MVA
    expect(rodar({ ajustar_mva: false }, true)).toMatchObject({ ok: true, icms: { p_mva_st: 400000 } });
    expect(rodar({ mva_ajustada: 500000 }, true, { ajustar_mva: null })).toMatchObject({ ok: true, icms: { p_mva_st: 500000 } });
  });
  it('RN-FIS-05: ST sem MVA (original e ajustada nulas) é REGRA_INCOMPLETA, com modBCST nulo ou 4 explícito', () => {
    expect(rodar({ mva_original: null })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(rodar({ mva_original: null, mod_bc_st: 4 })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(rodar({ mva_original: null, mva_ajustada: 500000 }, true)).toMatchObject({ ok: true, icms: { p_mva_st: 500000 } });
  });
});

describe('DIFAL / ICMSUFDest (RN-FIS-06; EC 87/2015, LC 190/2022, Convênio ICMS 236/2021)', () => {
  const ctx = (r: Parameters<typeof regra>[0], i: Partial<ItemCalculo> = {}, interestadual = false, ipi_na_bc = false) => ({ item: item(i), regra: regra(r), interestadual, ipi_na_bc });
  // R$ 1.000,00 de AM para SP (consumidor final não contribuinte): inter 12%, interna do destino 18%.
  const difal = (r: Record<string, unknown> = {}, i: Record<string, unknown> = {}) =>
    calcularIcmsItem({ ...ctx({ codigo: '00', aliquota_icms: 120000, aliquota_interna_destino: 180000, p_fcp_uf_dest: 0, difal_base_dupla: false, ...r }, i, true), destinatario_nao_contribuinte_final: true });
  it('RN-FIS-06: base única, sem FCP: DIFAL = BC × (interna − interestadual), 100% para o destino; o ICMS próprio segue na origem', () => {
    expect(difal()).toMatchObject({
      ok: true,
      icms: { v_bc: 100000, p_icms: 120000, v_icms: 12000 },
      icms_uf_dest: { v_bc_uf_dest: 100000, v_bc_fcp_uf_dest: 100000, p_fcp_uf_dest: 0, p_icms_uf_dest: 180000, p_icms_inter: 120000, p_icms_inter_part: 1000000, v_fcp_uf_dest: 0, v_icms_uf_dest: 6000, v_icms_uf_remet: 0 },
    });
  });
  it('RN-FIS-06: FCP do destino (2%) sai à parte, sobre a mesma base, e não entra no vICMSUFDest', () => {
    expect(difal({ p_fcp_uf_dest: 20000 })).toMatchObject({ ok: true, icms_uf_dest: { p_fcp_uf_dest: 20000, v_fcp_uf_dest: 2000, v_icms_uf_dest: 6000 } });
  });
  it('RN-FIS-06: base dupla: BC do destino = (BC − ICMS interestadual) / (1 − interna); DIFAL = BC dest × interna − ICMS interestadual', () => {
    // (100000 − 12000) / (1 − 0,18) = 107317,07 -> 107317 ; 107317 × 18% = 19317,06 -> 19317 ; − 12000 = 7317
    expect(difal({ difal_base_dupla: true, p_fcp_uf_dest: 20000 })).toMatchObject({ ok: true, icms_uf_dest: { v_bc_uf_dest: 107317, v_bc_fcp_uf_dest: 107317, v_icms_uf_dest: 7317, v_fcp_uf_dest: 2146, v_icms_uf_remet: 0 } });
  });
  it('RN-FIS-06: importado (origem 1) usa 4% interestadual: pICMSInter 4% e DIFAL sobre 14%', () => {
    expect(difal({}, { origem: '1' })).toMatchObject({ ok: true, icms: { p_icms: 40000, v_icms: 4000 }, icms_uf_dest: { p_icms_inter: 40000, v_icms_uf_dest: 14000 } });
  });
  it('RN-FIS-06: interna menor que a interestadual não gera DIFAL negativo (0)', () => {
    expect(difal({ aliquota_interna_destino: 100000 })).toMatchObject({ ok: true, icms_uf_dest: { v_icms_uf_dest: 0 } });
  });
  it('RN-FIS-06: não inventa alíquota: sem interna do destino, sem FCP do destino ou sem a base (única ou dupla) é REGRA_INCOMPLETA', () => {
    expect(difal({ aliquota_interna_destino: null })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(difal({ p_fcp_uf_dest: null })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(difal({ difal_base_dupla: null })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(difal({ aliquota_icms: null })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-06: CST 20 usa a BC reduzida como base do DIFAL; CST 40, 41, 50, 60 e CSOSN 300, 400, 500 não geram DIFAL', () => {
    expect(difal({ codigo: '20', reducao_bc: 500000 })).toMatchObject({ ok: true, icms_uf_dest: { v_bc_uf_dest: 50000, v_icms_uf_dest: 3000 } });
    for (const codigo of ['40', '41', '50', '60']) expect(difal({ codigo })).toEqual({ ok: true, icms: expect.any(Object) });
  });
  it('RN-FIS-06: Simples (CSOSN 102) calcula o DIFAL com as alíquotas da regra; ST, CST 51 e 90/900 seguem não suportados (fail-closed)', () => {
    expect(difal({ codigo: '102' })).toMatchObject({ ok: true, icms_uf_dest: { v_bc_uf_dest: 100000, v_icms_uf_dest: 6000 } });
    for (const codigo of ['10', '30', '70', '51', '90', '900', '201', '202', '203']) expect(difal({ codigo, mva_original: 400000, p_dif: 500000 })).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
  });
});
