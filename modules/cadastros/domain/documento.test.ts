import { describe, expect, it } from 'vitest';
import { validarDocumentoCliente } from './documento';

describe('documento do cliente', () => {
  it('RN-CAD-01: PJ com CNPJ de dígito verificador correto passa, com ou sem máscara', () => {
    expect(validarDocumentoCliente('PJ', '11.222.333/0001-81')).toEqual({ ok: true, documento: '11222333000181' });
  });
  it('RN-CAD-01: CNPJ alfanumérico válido passa', () => {
    expect(validarDocumentoCliente('PJ', '12ABC34501DE35').ok).toBe(true);
  });
  it('RN-CAD-01: CNPJ com dígito errado é recusado', () => {
    const r = validarDocumentoCliente('PJ', '11222333000182');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violacao.rn).toBe('RN-CAD-01');
  });
  it('RN-CAD-01: PF com CPF válido passa e CPF repetido é recusado', () => {
    expect(validarDocumentoCliente('PF', '529.982.247-25')).toEqual({ ok: true, documento: '52998224725' });
    expect(validarDocumentoCliente('PF', '11111111111').ok).toBe(false);
  });
  it('RN-CAD-01: CPF no lugar de CNPJ (tipo errado) é recusado', () => {
    expect(validarDocumentoCliente('PJ', '52998224725').ok).toBe(false);
    expect(validarDocumentoCliente('PF', '11222333000181').ok).toBe(false);
  });
});
