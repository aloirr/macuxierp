import { describe, expect, it } from 'vitest';
import { CalculoEntrada, CalculoSaida } from '../contracts';
import { calcularDocumento } from './documento';
import { item, regra } from './fixtures';

const base = (p: Record<string, unknown> = {}) =>
  CalculoEntrada.parse({
    emitente: { uf: 'AM', crt: 3, regime_pis_cofins: 'nao_cumulativo' },
    destinatario: { uf: 'AM', tipo_contribuinte: 'contribuinte', consumidor_final: false, tipo_pessoa: 'PJ' },
    operacao: { finalidade: 'normal', data_emissao: '2026-06-10' },
    itens: [item({ id: 'a' })],
    regras: [regra({ codigo: '00' })],
    ...p,
  });

describe('calcularDocumento', () => {
  it('RN-FIS-01: totais de frete, desconto e vNF somam os itens já arredondados', () => {
    const e = base({
      itens: [
        item({ id: 'a', valor_unitario_centavos: 125, valor_bruto_centavos: 125, frete_centavos: 5 }),
        item({ id: 'b', valor_unitario_centavos: 125, valor_bruto_centavos: 125, desconto_centavos: 5 }),
      ],
      regras: [regra({ codigo: '00', aliquota_icms: 100000 })],
    });
    const r = calcularDocumento(e);
    // a: BC 130 -> 13 ; b: BC 120 -> 12 ; soma dos itens 25 (e não 10% de 250 = 25: igual) ; BC total 250
    expect(r).toMatchObject({ ok: true, valor: { operacao: 'interna', totais: { v_bc: 250, v_icms: 25, v_prod: 250, v_frete: 5, v_desc: 5, v_nf: 250 } } });
  });
  it('RN-FIS-02: total é a soma dos itens arredondados, não o arredondamento do total', () => {
    const it = (id: string) => item({ id, valor_unitario_centavos: 105, valor_bruto_centavos: 105 });
    const r = calcularDocumento(base({ itens: [it('a'), it('b')], regras: [regra({ aliquota_icms: 100000 })] }));
    // 10,5 centavos -> 11 por item (meio para cima); 11+11 = 22 (e não 21 = 10% de 210)
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_icms: 22 } } });
  });
  it('RN-FIS-02: interestadual AM→SP a 12% e item importado a 4% no mesmo documento', () => {
    const r = calcularDocumento(
      base({
        destinatario: { uf: 'SP', tipo_contribuinte: 'contribuinte', consumidor_final: false, tipo_pessoa: 'PJ' },
        itens: [
          item({ id: 'a', cfop: '6102' }),
          item({ id: 'b', cfop: '6102', origem: '1' }),
        ],
        regras: [regra({ aliquota_icms: 120000, uf_destino: 'SP' })],
      }),
    );
    expect(r).toMatchObject({ ok: true, valor: { operacao: 'interestadual', totais: { v_icms: 16000, v_bc: 200000 } } });
  });
  it('RN-FIS-02: ST soma vST e FCP-ST no vNF', () => {
    const r = calcularDocumento(base({ regras: [regra({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000, p_fcp_st: 20000 })] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_bc_st: 140000, v_st: 7200, v_fcp_st: 2800, v_nf: 110000 } } });
  });
  it('RN-FIS-02: Simples com CSOSN 101 soma o crédito', () => {
    const r = calcularDocumento(base({ emitente: { uf: 'AM', crt: 1 }, regras: [regra({ codigo: '101', p_cred_sn: 28200, cst_pis: '99', cst_cofins: '99' })] }));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_cred_icms_sn: 2820, v_icms: 0 } } });
  });
  it('RN-FIS-01: resultado traz a regra usada com id e fonte', () => {
    const rg = regra({});
    const r = calcularDocumento(base({ regras: [rg] }));
    expect(r).toMatchObject({ ok: true, valor: { itens: [{ item_id: 'a', regra: { id: rg.id, fonte: { tipo: 'convenio' }, versao: '2025.1' } }] } });
  });
  it('RN-FIS-01: empate de regras é erro tipado com o item, sem exceção', () => {
    const r = calcularDocumento(base({ regras: [regra({}), regra({ aliquota_icms: 120000 })] }));
    expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_EMPATE', item_id: 'a' }] });
  });
  it('RN-FIS-04: erro de regra propaga o item_id', () => {
    expect(calcularDocumento(base({ regras: [regra({ fonte: null })] }))).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_SEM_FONTE', item_id: 'a' }] });
  });
  it('RN-FIS-01: junta os erros de todos os itens', () => {
    const it2 = (id: string, ncm: string) => item({ id, ncm, valor_unitario_centavos: 100, valor_bruto_centavos: 100 });
    const r = calcularDocumento(base({ itens: [it2('a', '22021000'), it2('b', '30049099'), it2('c', '30049099')], regras: [regra({ ncm_prefixo: '2202' })] }));
    expect(r).toMatchObject({ ok: false, erros: [{ item_id: 'b' }, { item_id: 'c' }] });
  });
  it('RN-FIS-02: interestadual a consumidor final não contribuinte volta CODIGO_NAO_SUPORTADO (DIFAL)', () => {
    const r = calcularDocumento(
      base({
        destinatario: { uf: 'SP', tipo_contribuinte: 'nao_contribuinte', consumidor_final: true, tipo_pessoa: 'PF' },
        itens: [item({ id: 'a', cfop: '6108' })],
        regras: [regra({ aliquota_icms: 120000 })],
      }),
    );
    expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02', codigo: 'CODIGO_NAO_SUPORTADO', item_id: 'a' }] });
  });

  describe('IPI, PIS e COFINS no documento (RF-FIS-01/02)', () => {
    const ind = { uf: 'AM', crt: 3, industrial_ipi: true, regime_pis_cofins: 'nao_cumulativo' };
    const rg = (p: Record<string, unknown> = {}) => regra({ cst_ipi: '50', aliquota_ipi: 100000, ...p });
    it('RN-FIS-02: IPI 10% com frete: vBC IPI 1.050,00, vIPI 105,00 entra no vNF; fora da BC do ICMS do contribuinte', () => {
      const r = calcularDocumento(base({ emitente: ind, itens: [item({ id: 'a', frete_centavos: 5000 })], regras: [rg()] }));
      expect(r).toMatchObject({
        ok: true,
        valor: {
          itens: [{ ipi: { cst: '50', v_bc: 105000, p_ipi: 100000, v_ipi: 10500 }, icms: { v_bc: 105000, v_icms: 18900 }, pis: { v_valor: 683 }, cofins: { v_valor: 3150 } }],
          totais: { v_ipi: 10500, v_icms: 18900, v_pis: 683, v_cofins: 3150, v_nf: 115500 },
        },
      });
    });
    it('RN-FIS-02: consumidor final não contribuinte: o IPI calculado entra na BC do ICMS (1.155,00 × 18% = 207,90)', () => {
      const r = calcularDocumento(
        base({
          emitente: ind,
          destinatario: { uf: 'AM', tipo_contribuinte: 'nao_contribuinte', consumidor_final: true, tipo_pessoa: 'PF' },
          itens: [item({ id: 'a', frete_centavos: 5000 })],
          regras: [rg()],
        }),
      );
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_bc: 115500, v_icms: 20790 } } });
    });
    it('RN-FIS-02: o IPI sempre entra na BC do ST: (1.000 + 100) × 1,40 × 18% − 180 = 97,20', () => {
      const r = calcularDocumento(base({ emitente: ind, regras: [rg({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000 })] }));
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_bc_st: 154000, v_icms: 18000, v_st: 9720, v_ipi: 10000, v_nf: 119720 } } });
    });
    it('RN-FIS-02: o ipi_centavos informado é substituído pelo calculado quando há regra de IPI', () => {
      const r = calcularDocumento(base({ emitente: ind, itens: [item({ id: 'a', ipi_centavos: 999 })], regras: [rg()] }));
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_ipi: 10000 } } });
    });
    it('RN-FIS-02: emitente não industrial não tem grupo IPI e mantém o ipi_centavos informado (lote 1)', () => {
      const r = calcularDocumento(base({ itens: [item({ id: 'a', ipi_centavos: 999 })], regras: [rg()] }));
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_ipi: 999 } } });
      expect((r as { valor: { itens: Array<{ ipi?: unknown }> } }).valor.itens[0]?.ipi).toBeUndefined();
    });
    it('RN-FIS-01: industrial sem regra de IPI é erro; a regra de IPI não é candidata ao ICMS', () => {
      const r = calcularDocumento(base({ emitente: ind, regras: [regra({})] }));
      expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA', item_id: 'a' }] });
      const so = calcularDocumento(base({ emitente: ind, regras: [regra({ tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000 })] }));
      expect(so).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_NAO_ENCONTRADA' }] });
    });
    it('RN-FIS-01: linhas dedicadas por tributo (icms, ipi, pis, cofins) funcionam como a linha única', () => {
      const semTrib = { cst_pis: null, cst_cofins: null, aliquota_pis: null, aliquota_cofins: null };
      const r = calcularDocumento(
        base({
          emitente: { ...ind, regime_pis_cofins: 'nao_cumulativo' },
          regras: [
            regra({ ...semTrib }),
            regra({ tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000 }),
            regra({ tributo: 'pis', cst_pis: '01', aliquota_pis: 16500 }),
            regra({ tributo: 'cofins', cst_cofins: '01', aliquota_cofins: 76000 }),
          ],
        }),
      );
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_icms: 18000, v_ipi: 10000, v_pis: 1650, v_cofins: 7600, v_nf: 110000 } } });
    });
    it('RN-FIS-02: exclusão do ICMS da BC de PIS/COFINS (tema 69): (1.000 − 180) → PIS 5,33 e COFINS 24,60', () => {
      const r = calcularDocumento(base({ regras: [regra({ excluir_icms_bc: true })] }));
      expect(r).toMatchObject({ ok: true, valor: { totais: { v_pis: 533, v_cofins: 2460 } } });
    });
    it('RN-FIS-02: Simples sem regra de PIS/COFINS sai CST 99 sem valor, sem erro', () => {
      const r = calcularDocumento(base({ emitente: { uf: 'AM', crt: 1 }, regras: [regra({ codigo: '102', cst_pis: null, cst_cofins: null, aliquota_pis: null, aliquota_cofins: null })] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ pis: { cst: '99' }, cofins: { cst: '99' } }], totais: { v_pis: 0, v_cofins: 0 } } });
    });
    it('RN-FIS-02: CRT 2 não exige regra de PIS/COFINS (DAS): sai CST 99 sem valor', () => {
      const r = calcularDocumento(base({ emitente: { uf: 'AM', crt: 2 }, regras: [regra({ codigo: '00', cst_pis: null, cst_cofins: null, aliquota_pis: null, aliquota_cofins: null })] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ pis: { cst: '99' }, cofins: { cst: '99' } }], totais: { v_pis: 0, v_cofins: 0 } } });
    });
    it('RN-FIS-02: CRT 3 sem regime_pis_cofins é erro tipado (não exceção do Zod)', () => {
      const e = base();
      const r = calcularDocumento({ ...e, emitente: { uf: 'AM', crt: 3, industrial_ipi: false } });
      expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02', codigo: 'REGRA_INCOMPLETA', item_id: 'a' }, { codigo: 'REGRA_INCOMPLETA' }] });
    });
    it('RN-FIS-01: regime normal sem regra de PIS/COFINS é erro por tributo', () => {
      const r = calcularDocumento(base({ regras: [regra({ cst_pis: null, cst_cofins: null })] }));
      expect(r).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA', item_id: 'a' }, { codigo: 'REGRA_NAO_ENCONTRADA', item_id: 'a' }] });
    });
    it('RN-FIS-01: empate de regras de PIS é erro só do PIS; o ICMS e a COFINS seguem normais', () => {
      const r = calcularDocumento(base({ regras: [regra({}), regra({ tributo: 'pis', cst_pis: '01', aliquota_pis: 16500 })] }));
      expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_EMPATE', item_id: 'a' }] });
      expect((r as { erros: unknown[] }).erros).toHaveLength(1);
    });
    it('RN-FIS-04: regra de IPI sem fonte não é aplicada, mesmo com regra de ICMS válida', () => {
      const r = calcularDocumento(base({ emitente: ind, regras: [regra({}), regra({ tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000, fonte: null })] }));
      expect(r).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE' }] });
    });
    it('RN-FIS-02: CST de PIS incompatível com o regime ou com o Simples é erro tipado', () => {
      const cum = calcularDocumento(base({ emitente: { uf: 'AM', crt: 3, regime_pis_cofins: 'cumulativo' }, regras: [regra({ cst_pis: '50' })] }));
      expect(cum).toMatchObject({ ok: false, erros: [{ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_REGIME', item_id: 'a' }] });
      const sn = calcularDocumento(base({ emitente: { uf: 'AM', crt: 1 }, regras: [regra({ codigo: '102' })] }));
      expect(sn).toMatchObject({ ok: false, erros: [{ codigo: 'CODIGO_INCOMPATIVEL_CRT' }, { codigo: 'CODIGO_INCOMPATIVEL_CRT' }] });
    });
  });
});

describe('emitente MEI revendedor (CRT 4, NT 2024.001): CSOSN 102 e 500 com ST retido', () => {
  const semPisCofins = { cst_pis: '99', aliquota_pis: null, cst_cofins: '99', aliquota_cofins: null };
  const stRetido = { v_bc_st_ret: 60000, p_st: 180000, v_icms_substituto: 5400, v_icms_st_ret: 5400 };
  const mei = (p: Record<string, unknown> = {}) =>
    CalculoEntrada.parse({
      emitente: { uf: 'AM', crt: 4 },
      destinatario: { uf: 'AM', tipo_contribuinte: 'nao_contribuinte', consumidor_final: true, tipo_pessoa: 'PF' },
      operacao: { finalidade: 'normal', data_emissao: '2026-11-22' },
      itens: [
        item({ id: 'a', ncm: '22021000', valor_unitario_centavos: 100000, valor_bruto_centavos: 100000 }),
        item({ id: 'b', ncm: '33049990', valor_unitario_centavos: 50000, valor_bruto_centavos: 50000, frete_centavos: 1000, st_retido: stRetido }),
      ],
      regras: [
        regra({ ncm_prefixo: '2202', codigo: '102', aliquota_icms: null, ...semPisCofins, fonte: { tipo: 'NT', referencia: 'NT 2024.001' } }),
        regra({ ncm_prefixo: '3304', codigo: '500', aliquota_icms: null, p_icms_efet: 180000, ...semPisCofins, fonte: { tipo: 'convenio', referencia: 'Convênio ICMS 142/2018' } }),
      ],
      ...p,
    });
  it('RN-FIS-02: MEI revendedor: 102 e 500 com st_retido, PIS/COFINS 99 no DAS, sem IPI e sem IBS/CBS; vNF = vProd + vFrete', () => {
    const r = calcularDocumento(mei());
    expect(r).toMatchObject({
      ok: true,
      valor: {
        operacao: 'interna',
        itens: [
          { item_id: 'a', icms: { orig: '0', csosn: '102' }, pis: { cst: '99' }, cofins: { cst: '99' } },
          {
            item_id: 'b',
            // efetivo: (500,00 + 10,00) × 18% = 91,80
            icms: { csosn: '500', v_bc_st_ret: 60000, p_st: 180000, v_icms_substituto: 5400, v_icms_st_ret: 5400, p_red_bc_efet: 0, v_bc_efet: 51000, p_icms_efet: 180000, v_icms_efet: 9180 },
            pis: { cst: '99' },
            cofins: { cst: '99' },
          },
        ],
        totais: { v_prod: 150000, v_frete: 1000, v_desc: 0, v_ipi: 0, v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp_st: 0, v_cred_icms_sn: 0, v_pis: 0, v_cofins: 0, v_nf: 151000 },
      },
    });
    const v = (r as { valor: { itens: Array<Record<string, unknown>>; totais: Record<string, unknown> } }).valor;
    for (const it of v.itens) for (const g of ['ipi', 'ibs_cbs', 'is', 'versao_nt_rtc']) expect(it).not.toHaveProperty(g);
    for (const g of ['v_ibs', 'v_cbs', 'v_is', 'v_nf_tot']) expect(v.totais).not.toHaveProperty(g);
  });
  it('RN-FIS-02: MEI com regra de CSOSN 101 (crédito) é recusado no documento', () => {
    const r = calcularDocumento(mei({ regras: [regra({ codigo: '101', p_cred_sn: 28200, ...semPisCofins })] }));
    expect(r).toMatchObject({ ok: false, erros: expect.arrayContaining([expect.objectContaining({ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_CRT' })]) });
  });
  it('RN-FIS-02: CST 51 no documento (regime normal): vICMS líquido do diferimento entra nos totais', () => {
    const r = calcularDocumento(base({ regras: [regra({ codigo: '51', p_dif: 333300 })] }));
    expect(r).toMatchObject({ ok: true, valor: { itens: [{ icms: { cst: '51', v_icms_op: 18000, v_icms_dif: 5999, v_icms: 12001 } }], totais: { v_bc: 100000, v_icms: 12001 } } });
  });
});

describe('total do FCP-ST retido (vFCPSTRet)', () => {
  const retido = (extra: Record<string, unknown>) => ({ v_bc_st_ret: 60000, p_st: 180000, v_icms_substituto: 5400, v_icms_st_ret: 5400, ...extra });
  const doc = (itens: unknown[]) => CalculoEntrada.parse({ ...base().valueOf(), itens, regras: [regra({ codigo: '60', aliquota_icms: null })] });
  it('RN-FIS-02: soma o vFCPSTRet dos itens e fica fora do vNF; sem item com o campo o total não sai', () => {
    const fcp = { v_bc_fcp_st_ret: 60000, p_fcp_st_ret: 20000, v_fcp_st_ret: 1200 };
    const r = calcularDocumento(doc([item({ id: 'a', st_retido: retido(fcp) }), item({ id: 'b', st_retido: retido({ ...fcp, v_fcp_st_ret: 800 }) }), item({ id: 'c', st_retido: retido({}) })]));
    expect(r).toMatchObject({ ok: true, valor: { totais: { v_fcp_st_ret: 2000, v_fcp_st: 0, v_nf: 300000 } } });
    const sem = calcularDocumento(doc([item({ id: 'a', st_retido: retido({}) })]));
    expect((sem as { valor: { totais: object } }).valor.totais).not.toHaveProperty('v_fcp_st_ret');
  });

  describe('ICMS-ST e IPI por regra: regra_aplicada, calc_st e calc_ipi (RN-FIS-05, 63 A)', () => {
    const ind = { uf: 'AM', crt: 3, industrial_ipi: true, regime_pis_cofins: 'nao_cumulativo' };
    const rSt = (p: Record<string, unknown> = {}) => regra({ codigo: '10', mva_original: 400000, aliquota_interna_destino: 180000, ...p });
    const rIpi = (p: Record<string, unknown> = {}) => regra({ tributo: 'ipi', cst_ipi: '50', aliquota_ipi: 100000, cst_pis: null, cst_cofins: null, ...p });
    it('RN-FIS-05: ST com regra: base R$ 1.000,00 × (1 + MVA 40%) = 1.400,00; × 18% − ICMS próprio 180,00 = 72,00; total igual ao item', () => {
      const r = calcularDocumento(base({ regras: [rSt()] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ regra_aplicada: { st: true, ipi: false }, calc_st: { v_bc: 140000, p_aliq: 180000, v_valor: 7200 } }], totais: { v_st: 7200, calc_st: { v_bc: 140000, v_valor: 7200 } } } });
    });
    it('RN-FIS-05: sem regra de ST (CST 00) o campo é omitido, nunca 0, e o v_st antigo segue 0', () => {
      const r = calcularDocumento(base());
      if (!r.ok) throw new Error('esperava ok');
      expect(r.valor.itens[0]).toMatchObject({ regra_aplicada: { st: false, ipi: false } });
      expect(r.valor.itens[0]).not.toHaveProperty('calc_st');
      expect(r.valor.itens[0]).not.toHaveProperty('calc_ipi');
      expect(r.valor.totais).not.toHaveProperty('calc_st');
      expect(r.valor.totais).not.toHaveProperty('calc_ipi');
      expect(r.valor.totais).toMatchObject({ v_st: 0, v_ipi: 0 });
    });
    it('RN-FIS-05: valor 0 COM regra é legítimo (redução de ST a 100%) e sai como calc_st zerado, com regra_aplicada.st = true', () => {
      const r = calcularDocumento(base({ regras: [rSt({ reducao_bc_st: 1000000 })] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ regra_aplicada: { st: true }, calc_st: { v_bc: 0, p_aliq: 180000, v_valor: 0 } }], totais: { calc_st: { v_bc: 0, v_valor: 0 } } } });
    });
    it('RN-FIS-05: item misto (um com regra de ST, outro sem) omite o total calc_st e mantém o calc_st do item com regra', () => {
      const r = calcularDocumento(base({ itens: [item({ id: 'a', ncm: '22021000' }), item({ id: 'b', ncm: '33030010' })], regras: [rSt({ ncm_prefixo: '2202' }), regra({ ncm_prefixo: '3303', codigo: '00' })] }));
      if (!r.ok) throw new Error(JSON.stringify(r.erros));
      expect(r.valor.itens.map((i) => i.regra_aplicada?.st)).toEqual([true, false]);
      expect(r.valor.itens[0]?.calc_st).toEqual({ v_bc: 140000, p_aliq: 180000, v_valor: 7200 });
      expect(r.valor.itens[1]).not.toHaveProperty('calc_st');
      expect(r.valor.totais).not.toHaveProperty('calc_st');
      expect(r.valor.totais.v_st).toBe(7200);
    });
    it('RN-FIS-05: arredondamento do Manual da NF-e (meio para cima): base 1,25 × (1 + 10%) = 1,375 → 1,38; × 10% = 0,138 → 0,14; − ICMS próprio 0,13 = 0,01', () => {
      const r = calcularDocumento(base({ itens: [item({ id: 'a', valor_unitario_centavos: 125, valor_bruto_centavos: 125 })], regras: [rSt({ aliquota_icms: 100000, mva_original: 100000, aliquota_interna_destino: 100000 })] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ calc_st: { v_bc: 138, p_aliq: 100000, v_valor: 1 } }] } });
    });
    it('RN-FIS-05: ST retido (CST 60) é repasse da nota de compra, não cálculo: sem calc_st e sem somar no v_st', () => {
      const r = calcularDocumento(base({ itens: [item({ id: 'a', st_retido: { v_bc_st_ret: 50000, p_st: 180000, v_icms_substituto: 0, v_icms_st_ret: 9000 } })], regras: [regra({ codigo: '60', aliquota_icms: null })] }));
      if (!r.ok) throw new Error(JSON.stringify(r.erros));
      expect(r.valor.itens[0]?.regra_aplicada).toEqual({ st: false, ipi: false });
      expect(r.valor.itens[0]).not.toHaveProperty('calc_st');
      expect(r.valor.totais).not.toHaveProperty('calc_st');
      expect(r.valor.totais.v_st).toBe(0);
    });
    it('RN-FIS-05: IPI ad valorem com regra: base 1.050,00 × 10% = 105,00 em calc_ipi do item e do total', () => {
      const r = calcularDocumento(base({ emitente: ind, itens: [item({ id: 'a', frete_centavos: 5000 })], regras: [regra({ codigo: '00' }), rIpi()] }));
      expect(r).toMatchObject({ ok: true, valor: { itens: [{ regra_aplicada: { st: false, ipi: true }, calc_ipi: { v_bc: 105000, p_aliq: 100000, v_valor: 10500 } }], totais: { v_ipi: 10500, calc_ipi: { v_bc: 105000, v_valor: 10500 } } } });
    });
    it('RN-FIS-05: IPI sem regra (emitente não industrial) omite calc_ipi no item e no total; industrial sem regra de IPI segue erro tipado (RN-FIS-01)', () => {
      const r = calcularDocumento(base({ regras: [regra({ codigo: '00' })] }));
      if (!r.ok) throw new Error(JSON.stringify(r.erros));
      expect(r.valor.itens[0]).toMatchObject({ regra_aplicada: { ipi: false } });
      expect(r.valor.itens[0]).not.toHaveProperty('calc_ipi');
      expect(r.valor.totais).not.toHaveProperty('calc_ipi');
    });
    it('RN-FIS-05: industrial sem regra de IPI — prévia (pedido/FDV): sem erro e calc_ipi omitido', () => {
      const r = calcularDocumento(base({ emitente: ind, regras: [regra({ codigo: '00' })] }), { modo: 'previa' });
      if (!r.ok) throw new Error(JSON.stringify(r.erros));
      expect(r.valor.itens[0]).toMatchObject({ regra_aplicada: { ipi: false } });
      expect(r.valor.itens[0]).not.toHaveProperty('calc_ipi');
      expect(r.valor.itens[0]).not.toHaveProperty('ipi');
      expect(r.valor.totais).not.toHaveProperty('calc_ipi');
      expect(r.valor.totais.v_ipi).toBe(0);
    });
    it('RN-FIS-01: industrial sem regra de IPI — emissão: REGRA_NAO_ENCONTRADA como antes (padrão e modo explícito)', () => {
      const e = base({ emitente: ind, regras: [regra({ codigo: '00' })] });
      expect(calcularDocumento(e)).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
      expect(calcularDocumento(e, { modo: 'emissao' })).toMatchObject({ ok: false, erros: [{ codigo: 'REGRA_NAO_ENCONTRADA' }] });
    });
    it('RN-FIS-05: IPI 0 com regra (CST 53, sem valor) sai calc_ipi zerado; por unidade usa o valor da regra sem alíquota inventada', () => {
      const a = calcularDocumento(base({ emitente: ind, regras: [regra({ codigo: '00' }), rIpi({ cst_ipi: '53', aliquota_ipi: null })] }));
      expect(a).toMatchObject({ ok: true, valor: { itens: [{ regra_aplicada: { ipi: true }, calc_ipi: { v_bc: 0, p_aliq: 0, v_valor: 0 } }] } });
      const u = calcularDocumento(base({ emitente: ind, itens: [item({ id: 'a', quantidade: 10 })], regras: [regra({ codigo: '00' }), rIpi({ aliquota_ipi: null, valor_unidade_ipi: 25000 })] }));
      expect(u).toMatchObject({ ok: true, valor: { itens: [{ calc_ipi: { v_bc: 0, p_aliq: 0, v_valor: 2500 } }], totais: { v_ipi: 2500, calc_ipi: { v_valor: 2500 } } } });
    });
    it('RN-FIS-05: a saída do motor passa no CalculoSaida (63 A) em todos os cenários', () => {
      const r = calcularDocumento(base({ emitente: ind, regras: [rSt(), rIpi()] }));
      if (!r.ok) throw new Error(JSON.stringify(r.erros));
      expect(CalculoSaida.safeParse(r.valor).success).toBe(true);
    });
  });
});
