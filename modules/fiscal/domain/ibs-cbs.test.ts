import { describe, expect, it } from 'vitest';
import { CalculoEntrada, RegraTributaria } from '../contracts';
import { calcularCargaAproximada } from './carga-aproximada';
import { calcularDocumento } from './documento';
import { aplicarPercentual, divArredonda, valorPorUnidade } from './dinheiro';
import { item, regra } from './fixtures';
import { aliquotaEfetiva, baseIbsCbs, calcularIbsCbsItem, calcularIsItem, validarCabecalhoRtc } from './ibs-cbs';

const NT = '2025.002-RTC v1.60';
/** Linha dedicada de IBS/CBS; 2026 em teste: CBS 0,9% e IBS 0,1% (a alíquota vem da regra). */
const rIbs = (p: Partial<RegraTributaria> = {}) =>
  regra({ tributo: 'ibs_cbs', codigo: null, cst_pis: null, aliquota_pis: null, cst_cofins: null, aliquota_cofins: null, aliquota_icms: null, cst_ibs_cbs: '000', c_class_trib: '000001', p_ibs_uf: 1000, p_ibs_mun: 0, p_cbs: 9000, fonte: { tipo: 'NT', referencia: 'NT 2025.002-RTC' }, versao_nt_rtc: NT, vigencia_inicio: '2026-01-01', ...p });
const rIs = (p: Partial<RegraTributaria> = {}) =>
  regra({ tributo: 'is', codigo: null, cst_pis: null, aliquota_pis: null, cst_cofins: null, aliquota_cofins: null, aliquota_icms: null, cst_is: '000', c_class_trib_is: '000001', p_is: 25000, fonte: { tipo: 'NT', referencia: 'NT 2025.002-RTC' }, versao_nt_rtc: NT, vigencia_inicio: '2026-01-01', ...p });
const zero = { data_emissao: '2026-06-10', v_icms: 0, v_fcp: 0, v_pis: 0, v_cofins: 0, v_is: 0 };

describe('arredondamento do IBS/CBS/IS (RN-FIS-03, RN-CORE-03)', () => {
  it('RN-CORE-03: o padrão do dinheiro comum (ICMS, IPI, PIS, COFINS) é meio para cima', () => {
    expect(aplicarPercentual(50, 10000)).toBe(1); // 0,5 centavo
    expect(divArredonda(5n, 10n)).toBe(1n);
  });
  it('RN-FIS-03: empate exato nos dois modos (0,5 e 2,5 centavos: cima 1 e 3, par 0 e 2; 3,5: ambos 4) e fora do empate coincidem', () => {
    expect(aplicarPercentual(50, 10000, 'meio_para_cima')).toBe(1);
    expect(aplicarPercentual(50, 10000, 'meio_para_par')).toBe(0);
    expect(aplicarPercentual(250, 10000, 'meio_para_cima')).toBe(3);
    expect(aplicarPercentual(250, 10000, 'meio_para_par')).toBe(2);
    expect(aplicarPercentual(350, 10000, 'meio_para_cima')).toBe(4);
    expect(aplicarPercentual(350, 10000, 'meio_para_par')).toBe(4);
    expect(aplicarPercentual(51, 10000, 'meio_para_par')).toBe(1);
    expect(aplicarPercentual(49, 10000, 'meio_para_par')).toBe(0);
  });
  it('RN-FIS-03: valor por unidade também aceita o modo (q 1 × 0,0050 real = 0,5 centavo)', () => {
    expect(valorPorUnidade(1, 50, 'meio_para_cima')).toBe(1);
    expect(valorPorUnidade(1, 50, 'meio_para_par')).toBe(0);
  });
  it('RN-FIS-03: a pAliqEfet também usa o modo, com padrão meio-para-par (0,0001% × 50% = 0,00005 → 0 no par, 1 para cima; 3 × 50% = 1,5 → 2 nos dois)', () => {
    expect(aliquotaEfetiva(1, 500000)).toBe(0);
    expect(aliquotaEfetiva(1, 500000, 'meio_para_par')).toBe(0);
    expect(aliquotaEfetiva(1, 500000, 'meio_para_cima')).toBe(1);
    expect(aliquotaEfetiva(3, 500000, 'meio_para_par')).toBe(2);
    expect(aliquotaEfetiva(3, 500000, 'meio_para_cima')).toBe(2);
  });
  it('RN-FIS-03: o padrão do IBS/CBS/IS é meio-para-par (CBS de 0,5 centavo vira 0; IS idem)', () => {
    const it50 = item({ valor_unitario_centavos: 50, valor_bruto_centavos: 50 });
    expect(calcularIbsCbsItem({ item: it50, regra: rIbs({ p_ibs_uf: 0, p_cbs: 10000 }), ...zero })).toMatchObject({ ok: true, v_cbs: 0 });
    expect(calcularIbsCbsItem({ item: it50, regra: rIbs({ p_ibs_uf: 0, p_cbs: 10000 }), ...zero, modo: 'meio_para_cima' })).toMatchObject({ ok: true, v_cbs: 1 });
    expect(calcularIsItem({ item: it50, regra: rIs({ p_is: 10000 }) })).toMatchObject({ v_is: 0 });
    expect(calcularIsItem({ item: it50, regra: rIs({ p_is: 10000 }), modo: 'meio_para_cima' })).toMatchObject({ v_is: 1 });
  });
});

describe('calcularIbsCbsItem (RF-FIS-03, NT 2025.002-RTC)', () => {
  it('RN-FIS-03: alíquota efetiva = alíquota × (1 − redução): 9% com 60% de redução = 3,6%', () => {
    expect(aliquotaEfetiva(90000, 600000)).toBe(36000);
    expect(aliquotaEfetiva(9000, 0)).toBe(9000);
  });
  it('RN-FIS-03: CHANGELOG 1.7.1 da Calculadora RTC: CBS 8,8123% com 60% de redução → pAliqEfet 3,5249 → vCBS 35.249,00 sobre 1.000.000,00', () => {
    const rg = rIbs({ cst_ibs_cbs: '200', c_class_trib: '200003', p_ibs_uf: 0, p_ibs_mun: 0, p_cbs: 88123, p_red_ibs: 0, p_red_cbs: 600000 });
    const r = calcularIbsCbsItem({ item: item({ valor_unitario_centavos: 100_000_000, valor_bruto_centavos: 100_000_000 }), regra: rg, ...zero });
    expect(aliquotaEfetiva(88123, 600000)).toBe(35249);
    expect(r).toMatchObject({ ok: true, v_bc: 100_000_000, v_cbs: 3_524_900, ibs_cbs: { g_cbs: { p_cbs: 88123, g_red: { p_red_aliq: 600000, p_aliq_efet: 35249 }, v_cbs: 3_524_900 } } });
  });
  it('RN-FIS-03: CST 000, 2026 teste: BC 1000,00 → IBS 0,1% = 1,00 e CBS 0,9% = 9,00, no leiaute da NT (sem gRed; versão fora do grupo)', () => {
    const r = calcularIbsCbsItem({ item: item(), regra: rIbs(), ...zero });
    expect(r).toMatchObject({ ok: true, v_bc: 100000, v_ibs_uf: 100, v_ibs_mun: 0, v_ibs: 100, v_cbs: 900, versao_nt_rtc: NT });
    expect(r.ok && r.ibs_cbs).toEqual({ cst: '000', c_class_trib: '000001', v_bc: 100000, g_ibs_uf: { p_ibs_uf: 1000, v_ibs_uf: 100 }, g_ibs_mun: { p_ibs_mun: 0, v_ibs_mun: 0 }, v_ibs: 100, g_cbs: { p_cbs: 9000, v_cbs: 900 } });
  });
  it('RN-FIS-03: a BC tira ICMS, PIS e COFINS: 100000 − 18000 − 650 − 3000 = 78350 → CBS 705, IBS 78', () => {
    const r = calcularIbsCbsItem({ item: item(), regra: rIbs(), ...zero, v_icms: 18000, v_pis: 650, v_cofins: 3000 });
    expect(r).toMatchObject({ ok: true, v_bc: 78350, v_cbs: 705, v_ibs: 78 });
  });
  it('RN-FIS-03: a BC também tira o FCP, o ICMS e FCP da UF de destino e o ICMS monofásico (2026 a 2032) e o ISSQN; soma o II; o IPI não entra', () => {
    const it = item({ v_ii: 5000, v_icms_uf_dest: 1000, v_fcp_uf_dest: 200, v_icms_mono: 300, v_issqn: 50, ipi_centavos: 10000 });
    expect(baseIbsCbs(it, { ...zero, v_icms: 18000, v_fcp: 400, v_pis: 650, v_cofins: 3000 })).toBe(100000 + 5000 - 650 - 3000 - 18000 - 1000 - 400 - 200 - 300 - 50);
    expect(baseIbsCbs(item({ ipi_centavos: 10000 }), zero)).toBe(100000);
  });
  it('RN-FIS-03: ICMS, FCP e monofásico só valem de 2026 a 2032: em 2033 a BC não os subtrai (PIS/COFINS ainda saem)', () => {
    const it = item({ v_icms_mono: 300 });
    expect(baseIbsCbs(it, { ...zero, data_emissao: '2032-12-31', v_icms: 18000, v_fcp: 400, v_cofins: 100 })).toBe(100000 - 18000 - 400 - 300 - 100);
    expect(baseIbsCbs(it, { ...zero, data_emissao: '2033-01-01', v_icms: 18000, v_fcp: 400, v_cofins: 100 })).toBe(100000 - 100);
    expect(baseIbsCbs(it, { ...zero, data_emissao: '2025-12-31', v_icms: 18000 })).toBe(100000);
  });
  it('RN-FIS-03: o IS integra a BC só a partir de 2027 (data de emissão): 2026 = 100000, 2027 = 102500 → CBS 922 (922,5 no par), IBS 102', () => {
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs(), ...zero, v_is: 2500 })).toMatchObject({ ok: true, v_bc: 100000, v_cbs: 900 });
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs(), ...zero, data_emissao: '2027-03-01', v_is: 2500 })).toMatchObject({ ok: true, v_bc: 102500, v_cbs: 922, v_ibs: 102 });
  });
  it('RN-FIS-03: CST 200 com redução de 60%: IBS UF 9%→3,6% = 3600, Mun 6%→2,4% = 2400, CBS 8,8%→3,52% = 3520, com gRed em cada grupo', () => {
    const rg = rIbs({ cst_ibs_cbs: '200', c_class_trib: '200003', p_ibs_uf: 90000, p_ibs_mun: 60000, p_cbs: 88000, p_red_ibs: 600000, p_red_cbs: 600000 });
    const r = calcularIbsCbsItem({ item: item(), regra: rg, ...zero });
    expect(r).toMatchObject({ ok: true, v_ibs_uf: 3600, v_ibs_mun: 2400, v_ibs: 6000, v_cbs: 3520 });
    expect(r.ok && r.ibs_cbs).toMatchObject({
      g_ibs_uf: { g_red: { p_red_aliq: 600000, p_aliq_efet: 36000 }, v_ibs_uf: 3600 },
      g_ibs_mun: { g_red: { p_red_aliq: 600000, p_aliq_efet: 24000 }, v_ibs_mun: 2400 },
      g_cbs: { g_red: { p_red_aliq: 600000, p_aliq_efet: 35200 }, v_cbs: 3520 },
    });
  });
  it('RN-FIS-03: redução de 100% zera o imposto', () => {
    const rg = rIbs({ cst_ibs_cbs: '200', c_class_trib: '200003', p_red_ibs: 1000000, p_red_cbs: 1000000 });
    expect(calcularIbsCbsItem({ item: item(), regra: rg, ...zero })).toMatchObject({ ok: true, v_ibs: 0, v_cbs: 0 });
  });
  it('RN-FIS-03: CST 410 (imunidade) sai só com CST e cClassTrib, sem valor', () => {
    const r = calcularIbsCbsItem({ item: item(), regra: rIbs({ cst_ibs_cbs: '410', c_class_trib: '410004', p_ibs_uf: null, p_cbs: null }), ...zero });
    expect(r).toMatchObject({ ok: true, v_ibs: 0, v_cbs: 0, ibs_cbs: { cst: '410', c_class_trib: '410004' } });
    expect(r.ok && r.ibs_cbs).toEqual({ cst: '410', c_class_trib: '410004' });
  });
  it('RN-FIS-03: cClassTrib que não começa com o CST é recusado (REGRA_INCOMPLETA); sem a versão da NT a regra não calcula', () => {
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ c_class_trib: '200003' }), ...zero })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ versao_nt_rtc: null }), ...zero })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-03: validarCabecalhoRtc é o mesmo para IBS/CBS e IS (CST/classe ausentes, sem versão, classe fora do CST)', () => {
    expect(validarCabecalhoRtc(rIbs(), 'IBS/CBS', '000', '000001')).toBeNull();
    expect(validarCabecalhoRtc(rIbs(), 'IBS/CBS', null, '000001')).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(validarCabecalhoRtc(rIs({ versao_nt_rtc: null }), 'IS', '000', '000001')).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(validarCabecalhoRtc(rIs(), 'IS', '000', '500001')).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-03: CST 000 com redução é incoerente; CST 200 sem redução é incompleto; sem alíquotas é incompleto', () => {
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ p_red_ibs: 100000 }), ...zero })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ cst_ibs_cbs: '200', c_class_trib: '200003' }), ...zero })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ p_cbs: null }), ...zero })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
  it('RN-FIS-03: CST ainda não coberto (220 alíquota fixa) volta CODIGO_NAO_SUPORTADO', () => {
    expect(calcularIbsCbsItem({ item: item(), regra: rIbs({ cst_ibs_cbs: '220', c_class_trib: '220001' }), ...zero })).toMatchObject({ ok: false, codigo: 'CODIGO_NAO_SUPORTADO' });
  });
  it('RN-FIS-03: base negativa é erro', () => {
    expect(calcularIbsCbsItem({ item: item({ desconto_centavos: 200000 }), regra: rIbs(), ...zero })).toMatchObject({ ok: false, codigo: 'BASE_NEGATIVA' });
  });
});

describe('calcularIsItem (RF-FIS-03, NT 2025.002-RTC gIS)', () => {
  it('RN-FIS-03: ad valorem 2,5% sobre 1000,00 = 25,00 (BC = valor da operação); a versão não sai no grupo', () => {
    const r = calcularIsItem({ item: item(), regra: rIs() });
    expect(r).toMatchObject({ ok: true, v_is: 2500, versao_nt_rtc: NT });
    expect(r.ok && r.is).toEqual({ cst_is: '000', c_class_trib_is: '000001', v_bc_is: 100000, p_is: 25000, v_is: 2500 });
  });
  it('RN-FIS-03: por unidade 10 × R$ 0,1411 = 1,411 → 1,41, com pISEspec, qTrib e uTrib quando houver', () => {
    const r = calcularIsItem({ item: item({ quantidade: 10, u_trib: 'LT' }), regra: rIs({ p_is: null, valor_unidade_is: 1411 }) });
    expect(r).toMatchObject({ ok: true, v_is: 141, is: { p_is_espec: 1411, q_trib: 10, u_trib: 'LT' } });
    const sem = calcularIsItem({ item: item({ quantidade: 10 }), regra: rIs({ p_is: null, valor_unidade_is: 1411 }) });
    expect(sem.ok && sem.is.u_trib).toBeUndefined();
  });
  it('RN-FIS-03: combinada (ad valorem + ad rem) soma as duas: 2500 + 141 (141,1 exato)', () => {
    expect(calcularIsItem({ item: item({ quantidade: 10 }), regra: rIs({ valor_unidade_is: 1411 }) })).toMatchObject({ ok: true, v_is: 2641 });
  });
  it('RN-FIS-03: na combinada o vIS é arredondado uma vez só: 0,4 + 0,4 centavo = 0,8 → 1 (arredondar cada parte daria 0)', () => {
    const it50 = item({ valor_unitario_centavos: 50, valor_bruto_centavos: 50 });
    expect(calcularIsItem({ item: it50, regra: rIs({ p_is: 8000 }) })).toMatchObject({ v_is: 0 }); // só o ad valorem: 0,4 → 0
    expect(calcularIsItem({ item: it50, regra: rIs({ p_is: 8000, valor_unidade_is: 40 }) })).toMatchObject({ ok: true, v_is: 1 });
  });
  it('RN-FIS-03: CST 500 (alíquota zero) sai sem valor; 000 sem alíquota é incompleto; sem versão é incompleto', () => {
    expect(calcularIsItem({ item: item(), regra: rIs({ cst_is: '500', c_class_trib_is: '500001' }) })).toMatchObject({ ok: true, v_is: 0 });
    expect(calcularIsItem({ item: item(), regra: rIs({ p_is: null }) })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
    expect(calcularIsItem({ item: item(), regra: rIs({ versao_nt_rtc: null }) })).toMatchObject({ ok: false, codigo: 'REGRA_INCOMPLETA' });
  });
});

describe('calcularCargaAproximada (RF-FIS-04, Lei 12.741/2012)', () => {
  const carga = { federal_nacional: 134500, federal_importado: 152500, estadual: 180000, municipal: 0, versao: '26.2.A', fonte: 'IBPT' };
  it('RF-FIS-04: nacional 13,45% + estadual 18% sobre 1000,00 = 134,50 + 180,00 = 314,50', () => {
    expect(calcularCargaAproximada(item(), carga)).toEqual({ v_tot_trib: 31450, v_federal: 13450, v_estadual: 18000, v_municipal: 0, versao: '26.2.A', fonte: 'IBPT' });
  });
  it('RF-FIS-04: origens 1, 2, 6 e 7 (importado) usam a alíquota federal de importado: 15,25% → 152,50', () => {
    for (const origem of ['1', '2', '6', '7']) expect(calcularCargaAproximada(item({ origem }), carga)).toMatchObject({ v_federal: 15250, v_tot_trib: 33250 });
  });
  it('RF-FIS-04: origens 0, 3, 4, 5 e 8 são nacionais: 13,45% → 134,50', () => {
    for (const origem of ['0', '3', '4', '5', '8']) expect(calcularCargaAproximada(item({ origem }), carga)).toMatchObject({ v_federal: 13450, v_tot_trib: 31450 });
  });
  it('RF-FIS-04: a soma é das esferas arredondadas (33333 × 18% = 5999,94 → 6000; 13,45% = 4483,3 → 4483)', () => {
    const r = calcularCargaAproximada(item({ valor_unitario_centavos: 33333, valor_bruto_centavos: 33333 }), carga);
    expect(r).toMatchObject({ v_estadual: 6000, v_federal: 4483, v_tot_trib: 10483 });
  });
  it('RF-FIS-04: a BC é o valor da operação (frete soma, desconto subtrai)', () => {
    expect(calcularCargaAproximada(item({ frete_centavos: 10000, desconto_centavos: 20000 }), { ...carga, federal_nacional: 100000, estadual: 0 })).toMatchObject({ v_tot_trib: 9000 });
  });
});

const doc = (p: Record<string, unknown> = {}) =>
  CalculoEntrada.parse({
    emitente: { uf: 'AM', crt: 3, regime_pis_cofins: 'nao_cumulativo' },
    destinatario: { uf: 'AM', tipo_contribuinte: 'contribuinte', consumidor_final: false, tipo_pessoa: 'PJ' },
    operacao: { finalidade: 'normal', data_emissao: '2026-06-10' },
    itens: [item({ id: 'a' })],
    regras: [regra({ codigo: '00' }), rIbs()],
    ...p,
  });

describe('calcularDocumento com IBS/CBS/IS/carga (RF-FIS-03/04)', () => {
  it('RN-FIS-03: ICMS 18000, PIS 650, COFINS 3000 → BC 78350, CBS 705, IBS 78; leiaute da NT, cfop, versão uma vez por item, regras_rtc; vNF fixo e vNFTot por fora', () => {
    const r = calcularDocumento(doc());
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_bc_ibs_cbs: 78350, v_ibs_uf: 78, v_ibs_mun: 0, v_ibs: 78, v_cbs: 705, v_nf: 100000, v_nf_tot: 100783 } } });
    const i = r.ok ? r.valor.itens[0] : undefined;
    expect(i).toMatchObject({ cfop: '5102', versao_nt_rtc: NT, ibs_cbs: { cst: '000', v_bc: 78350, v_ibs: 78, g_ibs_uf: { v_ibs_uf: 78 }, g_cbs: { v_cbs: 705 } }, regras_rtc: [{ tributo: 'ibs_cbs', versao_nt_rtc: NT, fonte: { tipo: 'NT' } }] });
    expect(i?.ibs).toBeUndefined();
    expect(i?.cbs).toBeUndefined();
    expect(i?.ibs_cbs).not.toHaveProperty('versao_nt_rtc');
  });
  it('RN-FIS-03: o vNF nunca soma IBS/CBS/IS; sem IBS/CBS nem IS não há vNFTot', () => {
    expect(calcularDocumento(doc({ regras: [regra({ codigo: '00' })] }))).toMatchObject({ ok: true, valor: { totais: { v_nf: 100000 } } });
    const sem = calcularDocumento(doc({ regras: [regra({ codigo: '00' })] }));
    expect(sem.ok && sem.valor.totais.v_nf_tot).toBeUndefined();
  });
  it('RN-FIS-03: o IS sozinho (sem regra de IBS/CBS) também gera vNFTot e a versão do item', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00' }), rIs()] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_is: 2500, v_nf: 100000, v_nf_tot: 102500 }, itens: [{ versao_nt_rtc: NT, regras_rtc: [{ tributo: 'is' }] }] } });
  });
  it('RN-FIS-03: opção de arredondamento chega ao IBS/CBS (item de 0,5 centavo de CBS): padrão meio-para-par = 0, meio para cima = 1', () => {
    const e = doc({ itens: [item({ id: 'a', valor_unitario_centavos: 50, valor_bruto_centavos: 50 })], regras: [regra({ aliquota_icms: 0, cst_pis: '04', aliquota_pis: null, cst_cofins: '04', aliquota_cofins: null }), rIbs({ p_ibs_uf: 0, p_cbs: 10000 })] });
    expect(calcularDocumento(e)).toMatchObject({ ok: true, valor: { totais: { v_cbs: 0 } } });
    expect(calcularDocumento(e, { arredondamento: 'meio_para_cima' })).toMatchObject({ ok: true, valor: { totais: { v_cbs: 1 } } });
  });
  it('RN-FIS-03: sem regra de IBS/CBS o grupo não sai e os totais opcionais ficam ausentes (não 0)', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00' })] }));
    expect(r.ok && r.valor.itens[0]?.ibs_cbs).toBeUndefined();
    expect(r.ok && r.valor.itens[0]?.v_tot_trib).toBeUndefined();
    if (r.ok) for (const k of ['v_ibs', 'v_cbs', 'v_is', 'v_bc_ibs_cbs', 'v_ibs_uf', 'v_ibs_mun', 'v_tot_trib', 'v_nf_tot']) expect(r.valor.totais).not.toHaveProperty(k);
  });
  it('RN-FIS-04: regra de IBS/CBS ainda sem vigência na emissão (2025) é ignorada', () => {
    const r = calcularDocumento(doc({ operacao: { finalidade: 'normal', data_emissao: '2025-12-01' } }));
    expect(r.ok && r.valor.totais).not.toHaveProperty('v_cbs');
  });
  it('RN-FIS-03: linha única do banco (ICMS + cst_ibs_cbs na mesma linha) também vale', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00', cst_ibs_cbs: '000', c_class_trib: '000001', p_ibs_uf: 1000, p_ibs_mun: 0, p_cbs: 9000, versao_nt_rtc: NT })] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_cbs: 705 } } });
  });
  it('RN-FIS-03: regra de IBS/CBS inconsistente vira erro tipado do documento, com o item', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00' }), rIbs({ c_class_trib: '200003' })] }));
    expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-03', codigo: 'REGRA_INCOMPLETA', item_id: 'a' }] });
  });
  it('RN-FIS-03: em 2026 o IS sai nos totais mas não entra na BC do IBS/CBS (BC 78350, CBS 705); vNFTot = 100000 + 78 + 705 + 2500', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00' }), rIbs(), rIs()] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_is: 2500, v_bc_ibs_cbs: 78350, v_cbs: 705, v_nf: 100000, v_nf_tot: 103283 } } });
  });
  it('RN-FIS-03: a partir de 2027 o IS entra na BC: 100000 − 18000 − 650 − 3000 + 2500 = 80850; CBS 727,65 → 728; IBS 80,85 → 81', () => {
    const r = calcularDocumento(doc({ operacao: { finalidade: 'normal', data_emissao: '2027-03-01' }, regras: [regra({ codigo: '00' }), rIbs(), rIs()] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_is: 2500, v_bc_ibs_cbs: 80850, v_cbs: 728, v_ibs: 81, v_nf: 100000, v_nf_tot: 103309 } } });
  });
  it('RN-FIS-03: o FCP do ICMS sai da BC do IBS/CBS (FCP 2% = 2000: 100000 − 20000 − 650 − 3000 = 76350 → CBS 687)', () => {
    const r = calcularDocumento(doc({ regras: [regra({ codigo: '00', p_fcp: 20000 }), rIbs()] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_bc_ibs_cbs: 78350 - 2000, v_cbs: 687 } } });
  });
  it('RF-FIS-04: vTotTrib por item e no total, com versão e fonte', () => {
    const carga = { federal_nacional: 134500, federal_importado: 152500, estadual: 180000, municipal: 0, versao: '26.2.A', fonte: 'IBPT' };
    const r = calcularDocumento(doc({ itens: [item({ id: 'a', carga_aproximada: carga }), item({ id: 'b', origem: '1', carga_aproximada: carga }), item({ id: 'c' })] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_tot_trib: 31450 + 33250 } } });
    expect(r.ok && r.valor.itens.map((i) => i.v_tot_trib)).toEqual([31450, 33250, undefined]);
    expect(r.ok && r.valor.itens[0]?.carga_aproximada).toMatchObject({ v_federal: 13450, versao: '26.2.A', fonte: 'IBPT' });
  });
});

describe('contrato do lote 3 (aditivo)', () => {
  it('RN-FIS-03: tributo aceita ibs_cbs e is; os campos novos têm padrão nulo e o formato é validado', () => {
    expect(RegraTributaria.parse({ ...regra(), tributo: 'is', codigo: null }).cst_is).toBeNull();
    expect(regra().cst_ibs_cbs).toBeNull();
    expect(() => RegraTributaria.parse({ ...rIbs(), c_class_trib: '1234' })).toThrow();
    expect(() => RegraTributaria.parse({ ...rIbs(), cst_ibs_cbs: '00' })).toThrow();
    expect(() => RegraTributaria.parse({ ...rIbs(), p_cbs: 1_000_001 })).toThrow();
  });
});
