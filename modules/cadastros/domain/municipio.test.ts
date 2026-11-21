import { describe, expect, it } from 'vitest';
import { validarEnderecoPrincipal, validarMunicipio } from './municipio';

describe('município', () => {
  it('RN-CAD-03: código IBGE de 7 dígitos coerente com a UF passa (Manaus, AM)', () => {
    expect(validarMunicipio('1302603', 'AM')).toEqual({ ok: true });
  });
  it('RN-CAD-03: código de outra UF é recusado', () => {
    const r = validarMunicipio('3550308', 'AM'); // São Paulo
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violacao.rn).toBe('RN-CAD-03');
  });
  it('RN-CAD-03: código com dígito verificador errado ou fora de 7 dígitos é recusado', () => {
    expect(validarMunicipio('1302604', 'AM').ok).toBe(false);
    expect(validarMunicipio('130260', 'AM').ok).toBe(false);
    expect(validarMunicipio('Manaus', 'AM').ok).toBe(false);
  });
  it('RN-CAD-03: UF desconhecida é recusada', () => {
    expect(validarMunicipio('1302603', 'XX').ok).toBe(false);
  });
});

describe('endereço principal do cliente', () => {
  it('RN-CAD-03: exatamente um endereço principal passa', () => {
    expect(validarEnderecoPrincipal([{ tipo: 'principal' }, { tipo: 'entrega' }])).toEqual({ ok: true });
  });
  it('RN-CAD-03: sem endereço principal é recusado', () => {
    const r = validarEnderecoPrincipal([{ tipo: 'entrega' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violacao.rn).toBe('RN-CAD-03');
  });
  it('RN-CAD-03: mais de um endereço principal é recusado', () => {
    expect(validarEnderecoPrincipal([{ tipo: 'principal' }, { tipo: 'principal' }]).ok).toBe(false);
  });
});
