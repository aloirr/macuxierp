import { describe, expect, it } from 'vitest';
import { CalculoEntrada } from '../contracts';
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
