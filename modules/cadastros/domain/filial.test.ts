import { describe, expect, it } from 'vitest';
import { bloqueiosDeInativacao, validarFilial } from './filial';

const ok = { uf: 'AM', municipio_ibge: '1302603', ie: null, nfe_serie: 1, nfe_numero_inicial: 1, emissora: true };

describe('filial', () => {
  it('D8: série e número inicial da NF-e vêm juntos ou nenhum dos dois', () => {
    expect(validarFilial({ ...ok, nfe_numero_inicial: null })[0]).toMatchObject({ rn: 'D8', campo: 'nfe_numero_inicial' });
    expect(validarFilial({ ...ok, nfe_serie: null })[0]).toMatchObject({ rn: 'D8', campo: 'nfe_serie' });
    expect(validarFilial({ ...ok, emissora: false, nfe_serie: null, nfe_numero_inicial: null })).toEqual([]);
  });
  it('D8: filial emissora precisa de série e número inicial', () => {
    expect(validarFilial({ ...ok, nfe_serie: null, nfe_numero_inicial: null })[0]).toMatchObject({ rn: 'D8' });
  });
  it('RN-CAD-03: município coerente com a UF da filial', () => {
    expect(validarFilial({ ...ok, uf: 'SP' })[0]).toMatchObject({ rn: 'RN-CAD-03' });
  });
  it('RN-CAD-02: IE da filial pela regra da UF; ISENTO não vale para filial', () => {
    expect(validarFilial({ ...ok, ie: '012345679' })).toEqual([]);
    expect(validarFilial({ ...ok, ie: '012345678' })[0]).toMatchObject({ rn: 'RN-CAD-02' });
    expect(validarFilial({ ...ok, ie: 'ISENTO' })[0]).toMatchObject({ rn: 'RN-CAD-02' });
  });
});

describe('regime PIS/COFINS (RN-FIS-02)', () => {
  it('RN-FIS-02: regime_pis_cofins só vale no CRT 3; informado nos CRT 1, 2 e 4 é violação', () => {
    for (const crt of ['1', '2', '4'] as const) {
      expect(validarFilial({ ...ok, crt, regime_pis_cofins: 'cumulativo' })[0]).toMatchObject({ rn: 'RN-FIS-02', campo: 'regime_pis_cofins' });
      expect(validarFilial({ ...ok, crt, regime_pis_cofins: null })).toEqual([]);
    }
    expect(validarFilial({ ...ok, crt: '3', regime_pis_cofins: 'nao_cumulativo' })).toEqual([]);
    expect(validarFilial({ ...ok, crt: '3', regime_pis_cofins: null })).toEqual([]);
  });
});

describe('inativação', () => {
  it('RN-CAD-08: filial padrão e tabela de preço padrão não são inativadas enquanto forem a padrão', () => {
    expect(bloqueiosDeInativacao('filial', { padrao: true })[0]).toMatchObject({ rn: 'RN-CAD-08' });
    expect(bloqueiosDeInativacao('tabela_preco', { padrao: true })[0]).toMatchObject({ rn: 'RN-CAD-08' });
    expect(bloqueiosDeInativacao('cliente', { padrao: false })).toEqual([]);
    expect(bloqueiosDeInativacao('filial', { padrao: false })).toEqual([]);
  });
});
