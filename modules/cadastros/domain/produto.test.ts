import { describe, expect, it } from 'vitest';
import { validarFiscalProduto } from './produto';

const base = { ncm: '22021000', cest: null, ncmVigente: true, ncmExigeCest: false, cestVigente: true, cestCombinaComNcm: true };

describe('dados fiscais do produto', () => {
  it('RN-CAD-04: NCM existente e vigente, sem ST, passa sem CEST', () => {
    expect(validarFiscalProduto(base)).toEqual([]);
  });
  it('RN-CAD-04: NCM inexistente ou fora da vigência é recusado', () => {
    const v = validarFiscalProduto({ ...base, ncmVigente: false });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rn: 'RN-CAD-04', campo: 'ncm' });
  });
  it('RN-CAD-04: NCM em segmento com substituição tributária exige CEST', () => {
    const v = validarFiscalProduto({ ...base, ncmExigeCest: true });
    expect(v[0]).toMatchObject({ rn: 'RN-CAD-04', campo: 'cest' });
  });
  it('RN-CAD-04: CEST informado precisa estar vigente e combinar com o NCM', () => {
    expect(validarFiscalProduto({ ...base, ncmExigeCest: true, cest: '0300100' })).toEqual([]);
    expect(validarFiscalProduto({ ...base, cest: '0300100', cestVigente: false })[0]?.campo).toBe('cest');
    expect(validarFiscalProduto({ ...base, cest: '0300100', cestCombinaComNcm: false })[0]?.campo).toBe('cest');
  });
  it('RN-CAD-04: as 4 mensagens citam o código formatado e a ação (A0)', () => {
    expect(validarFiscalProduto({ ...base, ncm: '42022210', ncmVigente: false })[0]?.mensagem).toBe('NCM 4202.22.10 não existe ou não está vigente: confira a coluna ncm.');
    expect(validarFiscalProduto({ ...base, ncm: '42022210', ncmExigeCest: true })[0]?.mensagem).toBe('O NCM 4202.22.10 exige CEST: preencha a coluna cest.');
    expect(validarFiscalProduto({ ...base, ncm: '42022210', cest: '0300100', cestVigente: false })[0]?.mensagem).toBe('CEST 0300100 não existe ou não está vigente: confira a coluna cest.');
    expect(validarFiscalProduto({ ...base, ncm: '42022210', cest: '0300100', cestCombinaComNcm: false })[0]?.mensagem).toBe('O CEST 0300100 não pertence ao NCM 4202.22.10: confira as colunas ncm e cest.');
  });
});
