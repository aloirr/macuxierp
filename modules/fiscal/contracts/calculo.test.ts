import { describe, expect, it } from 'vitest';
import { CalculoSaida, CalculoEntrada, EmitenteCalculo, CalculoResultado, ItemCalculo, ItemResultado, RegraTributaria, TotaisCalculo } from './index';
import { regra } from '../domain/fixtures';
import { calculoComRegra, calculoItemMisto, calculoSemRegra } from './fixtures';

const regraOk = regra({ ncm_prefixo: '2202' });
const itemOk = { id: 'i1', ncm: '22021000', cfop: '5102', quantidade: 2, valor_unitario_centavos: 500, valor_bruto_centavos: 1000, origem: '0' };
const entradaOk = {
  emitente: { uf: 'AM', crt: 3 },
  destinatario: { uf: 'SP', tipo_contribuinte: 'contribuinte', consumidor_final: false, tipo_pessoa: 'PJ' },
  operacao: { finalidade: 'normal', data_emissao: '2026-06-10' },
  itens: [itemOk],
  regras: [regraOk],
};

const emitenteOk = (e: unknown) => EmitenteCalculo.safeParse(e).success;

describe('contrato fiscal.calculo@1', () => {
  it('RN-FIS-04: entrada válida aplica defaults (desconto, frete, IPI = 0)', () => {
    const r = CalculoEntrada.parse(entradaOk);
    expect(r.itens[0]).toMatchObject({ desconto_centavos: 0, frete_centavos: 0, ipi_centavos: 0 });
    expect(r.regras[0]).toMatchObject({ mod_bc: 3, mva_original: null, ajustar_mva: false });
  });
  it('RN-FIS-01: entrada inválida (NCM curto, CRT 5, valor fracionado, sem itens, UF minúscula)', () => {
    expect(ItemCalculo.safeParse({ ...itemOk, ncm: '2202' }).success).toBe(false);
    expect(ItemCalculo.safeParse({ ...itemOk, valor_bruto_centavos: 10.5 }).success).toBe(false);
    expect(ItemCalculo.safeParse({ ...itemOk, origem: '9' }).success).toBe(false);
    expect(CalculoEntrada.safeParse({ ...entradaOk, emitente: { uf: 'AM', crt: 5 } }).success).toBe(false);
    expect(CalculoEntrada.safeParse({ ...entradaOk, itens: [] }).success).toBe(false);
    expect(CalculoEntrada.safeParse({ ...entradaOk, destinatario: { ...entradaOk.destinatario, uf: 'sp' } }).success).toBe(false);
  });
  it('RN-FIS-04: regra exige vigência e versão; alíquota é inteira com 4 casas e limitada a 100%', () => {
    expect(RegraTributaria.safeParse({ ...regraOk, vigencia_inicio: undefined }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...regraOk, aliquota_icms: 18.5 }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...regraOk, reducao_bc: 1000001 }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...regraOk, aliquota_icms: 1000001 }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...regraOk, p_fcp: 1000001 }).success).toBe(false);
    expect(RegraTributaria.safeParse({ ...regraOk, mva_original: 5_000_000 }).success).toBe(true);
    expect(RegraTributaria.safeParse({ ...regraOk, fonte: null }).success).toBe(true); // o domínio recusa a aplicação (RN-FIS-04)
  });
  it('RN-FIS-01: resultado é união tipada ok/erros', () => {
    expect(CalculoResultado.safeParse({ ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_EMPATE', mensagem: 'x' }] }).success).toBe(true);
    expect(CalculoResultado.safeParse({ ok: false, erros: [] }).success).toBe(false);
    expect(CalculoResultado.safeParse({ ok: false, erros: [{ rn: 'X', codigo: 'REGRA_EMPATE', mensagem: 'x' }] }).success).toBe(false);
  });
  it('RN-FIS-01: campos de lotes futuros são opcionais e tipados', () => {
    expect(emitenteOk({ uf: 'AM', crt: 3, regime_pis_cofins: 'nao_cumulativo' })).toBe(true);
    expect(emitenteOk({ uf: 'AM', crt: 3, regime_pis_cofins: 'outro' })).toBe(false);
    expect(ItemResultado.safeParse({ item_id: 'a', icms: { orig: '0' }, ipi: { cst: '50', v_ipi: 100 }, is: { v_is: 5 }, regra: { id: regraOk.id, fonte: regraOk.fonte, versao: '1' } }).success).toBe(true);
    expect(ItemResultado.safeParse({ item_id: 'a', icms: { orig: '0' }, pis: { v_valor: -1 }, regra: { id: regraOk.id, fonte: regraOk.fonte, versao: '1' } }).success).toBe(false);
    const t = { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: 0, v_cred_icms_sn: 0 };
    expect(TotaisCalculo.safeParse(t).success).toBe(true);
    expect(TotaisCalculo.safeParse({ ...t, v_pis: 1, v_tot_trib: 2 }).success).toBe(true);
  });
});

describe('contrato fiscal.calculo@1: ST e IPI por regra (RN-FIS-05)', () => {
  it('RN-FIS-05: com regra, o item e o total trazem calc_st e calc_ipi, e o 0 com regra é válido', () => {
    const r = CalculoSaida.parse(calculoComRegra);
    expect(r.itens[1]?.calc_st?.v_valor).toBe(0);
    expect(r.totais.calc_st?.v_valor).toBe(360);
  });
  it('RN-FIS-05: sem regra, os campos são omitidos; um 0 sem regra é recusado', () => {
    expect(CalculoSaida.safeParse(calculoSemRegra).success).toBe(true);
    const zeroSemRegra = { ...calculoSemRegra, itens: [{ ...calculoSemRegra.itens[0], calc_st: { v_bc: 0, p_aliq: 0, v_valor: 0 } }] };
    expect(CalculoSaida.safeParse(zeroSemRegra).success).toBe(false);
  });
  it('RN-FIS-05: item misto omite o total; total presente com item sem regra é recusado', () => {
    const r = CalculoSaida.parse(calculoItemMisto);
    expect(r.totais.calc_st).toBeUndefined();
    expect(r.totais.calc_ipi).toBeUndefined();
    const total = { ...calculoItemMisto, totais: { ...calculoItemMisto.totais, calc_ipi: { v_bc: 0, v_valor: 0 } } };
    expect(CalculoSaida.safeParse(total).success).toBe(false);
  });
  it('RN-FIS-05: compatível com o @1, o resultado antigo (sem os campos novos) continua válido', () => {
    const antigo = { operacao: 'interna', itens: [{ item_id: 'a', icms: { orig: '0' }, regra: { id: regraOk.id, fonte: regraOk.fonte, versao: '1' } }], totais: calculoSemRegra.totais };
    expect(CalculoSaida.safeParse(antigo).success).toBe(true);
  });
});
