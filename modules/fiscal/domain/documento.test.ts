import { describe, expect, it } from 'vitest';
import { CalculoEntrada } from '../contracts';
import { calcularDocumento } from './documento';
import { item, regra } from './fixtures';

const base = (p: Record<string, unknown> = {}) =>
  CalculoEntrada.parse({
    emitente: { uf: 'AM', crt: 3 },
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
    const r = calcularDocumento(base({ emitente: { uf: 'AM', crt: 1 }, regras: [regra({ codigo: '101', p_cred_sn: 28200 })] }));
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
});
