import { describe, expect, it } from 'vitest';
import { normalizarNome, resolverMunicipio } from './municipio-por-nome';

const SP = [
  { ibge: '3550308', nome: 'São Paulo' },
  { ibge: '3500105', nome: "Santa Bárbara d'Oeste" },
  { ibge: '3501001', nome: 'Alto-Alegre' },
  { ibge: '3599991', nome: 'Duplicada' },
  { ibge: '3599992', nome: 'DUPLICADA' },
];

describe('município por nome', () => {
  it('RN-CAD-03: ignora acento, caixa e espaços repetidos', () => {
    expect(resolverMunicipio('  sao   PAULO ', SP)).toEqual({ ok: true, ibge: '3550308' });
  });
  it("RN-CAD-03: apóstrofo e hífen valem como espaço", () => {
    expect(resolverMunicipio('Santa Barbara d’Oeste', SP)).toEqual({ ok: true, ibge: '3500105' });
    expect(resolverMunicipio('Alto Alegre', SP)).toEqual({ ok: true, ibge: '3501001' });
    expect(normalizarNome("d'Oeste")).toBe('D OESTE');
  });
  it('RN-CAD-03: cidade inexistente na UF é recusada', () => {
    expect(resolverMunicipio('Atlantida', SP)).toEqual({ ok: false, codigo: 'nao_encontrado', motivo: 'município não encontrado na UF' });
  });
  it('RN-CAD-03: nome ambíguo é recusado e pede o municipio_ibge', () => {
    expect(resolverMunicipio('duplicada', SP)).toEqual({ ok: false, codigo: 'ambiguo', motivo: 'município ambíguo: informe municipio_ibge' });
  });
});
