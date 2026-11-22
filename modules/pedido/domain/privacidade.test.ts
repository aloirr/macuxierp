import { PERFIS } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ocultarDocumento, podeVerDocumentoCliente } from './privacidade';

describe('documento do cliente (LGPD, regra 8)', () => {
  it('LGPD: só o vendedor não vê o documento do cliente', () => {
    for (const p of PERFIS) expect(podeVerDocumentoCliente(p)).toBe(p !== 'vendedor');
  });
  it('LGPD: ocultarDocumento zera o documento do retrato para quem não pode ver e não mexe no resto', () => {
    const r = { documento: '12345678901', razao_social: 'X' };
    expect(ocultarDocumento(r, 'vendedor')).toEqual({ documento: null, razao_social: 'X' });
    expect(ocultarDocumento(r, 'gerente')).toBe(r);
  });
});
