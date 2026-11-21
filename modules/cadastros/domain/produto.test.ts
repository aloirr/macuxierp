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
});
