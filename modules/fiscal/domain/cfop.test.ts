import { describe, expect, it } from 'vitest';
import { cfopBase, cfopPeloIcms, destinatarioPeloIndIe, type EntradaCfop } from './cfop';

const e = (uf_destino: string, industrial_ipi = false, tipo_contribuinte: EntradaCfop['tipo_contribuinte'] = 'contribuinte'): EntradaCfop => ({
  uf_emitente: 'AM', uf_destino, industrial_ipi, tipo_contribuinte,
});

describe('escolha do CFOP (RN-FIS-01, Ajuste SINIEF 07/2001)', () => {
  it('RN-FIS-01: venda de mercadoria de terceiros é 5102 na mesma UF e 6102 em outra UF', () => {
    expect(cfopBase(e('AM'))).toBe('5102');
    expect(cfopBase(e('SP'))).toBe('6102');
  });
  it('RN-FIS-01: emitente industrial vende produção própria como 5101/6101', () => {
    expect(cfopBase(e('AM', true))).toBe('5101');
    expect(cfopBase(e('SP', true))).toBe('6101');
  });
  it('RN-FIS-01: interestadual para não contribuinte é 6108 (terceiros) e 6107 (industrial); interna não muda', () => {
    expect(cfopBase(e('SP', false, 'nao_contribuinte'))).toBe('6108');
    expect(cfopBase(e('SP', true, 'nao_contribuinte'))).toBe('6107');
    expect(cfopBase(e('AM', false, 'nao_contribuinte'))).toBe('5102');
    expect(cfopBase(e('SP', false, 'isento'))).toBe('6102');
  });
  it('RN-FIS-01: ICMS-ST retido na compra (CST 60 / CSOSN 500) é 5405 interna e 6404 interestadual, também para industrial', () => {
    expect(cfopPeloIcms(e('AM'), '60')).toBe('5405');
    expect(cfopPeloIcms(e('SP'), '500')).toBe('6404');
    expect(cfopPeloIcms(e('AM', true), '60')).toBe('5405');
    expect(cfopPeloIcms(e('SP', true), '500')).toBe('6404');
  });
  it('RN-FIS-01: substituto tributário (CST 10/30/70, CSOSN 201/202/203) é 5403/6403 (terceiros) e 5401/6401 (produção própria)', () => {
    expect(cfopPeloIcms(e('AM'), '10')).toBe('5403');
    expect(cfopPeloIcms(e('SP'), '201')).toBe('6403');
    expect(cfopPeloIcms(e('AM'), '203')).toBe('5403');
    expect(cfopPeloIcms(e('SP', true), '203')).toBe('6401');
    expect(cfopPeloIcms(e('AM', true), '70')).toBe('5401');
  });
  it('RN-FIS-01: sem ST o CFOP fica o base', () => {
    expect(cfopPeloIcms(e('SP'), '00')).toBe('6102');
    expect(cfopPeloIcms(e('AM'), undefined)).toBe('5102');
  });
  it('RN-FIS-01: ind_ie_dest vira tipo de contribuinte e consumidor final (só o 1 não é consumidor final)', () => {
    expect(destinatarioPeloIndIe('1')).toEqual({ tipo_contribuinte: 'contribuinte', consumidor_final: false });
    expect(destinatarioPeloIndIe('2')).toEqual({ tipo_contribuinte: 'isento', consumidor_final: true });
    expect(destinatarioPeloIndIe('9')).toEqual({ tipo_contribuinte: 'nao_contribuinte', consumidor_final: true });
  });
});
