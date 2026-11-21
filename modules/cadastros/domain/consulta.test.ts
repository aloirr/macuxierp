import { describe, expect, it } from 'vitest';
import { cacheValido, expiraEm, paraCacheCnpj, removerCpf, TTL_CACHE_MS } from './consulta';

describe('consulta externa', () => {
  it('RN-CAD-05: o cache do CNPJ não guarda quadro de sócios nem contatos', () => {
    const cru = { cnpj: '11222333000181', razao_social: 'ACME LTDA', qsa: [{ nome_socio: 'Fulano', cnpj_cpf_do_socio: '***123456**' }], socios: [{ x: 1 }], email: 'a@b.com', ddd_telefone_1: '9233334444' };
    const limpo = JSON.stringify(paraCacheCnpj(cru));
    expect(limpo).not.toMatch(/qsa|socios|Fulano|a@b\.com|9233334444/);
    expect(limpo).toContain('ACME LTDA');
  });
  it('RN-CAD-05: CPF dentro de texto livre (razão social de MEI) é removido', () => {
    expect(removerCpf('JOAO DA SILVA 52998224725')).toBe('JOAO DA SILVA');
    expect(removerCpf('MARIA 529.982.247-25 ME')).toBe('MARIA ME');
    expect(removerCpf('LOJA 12345678000195')).toBe('LOJA 12345678000195'); // CNPJ de 14 dígitos fica
  });
  it('RN-CAD-05: o cache vale 24 h', () => {
    const t0 = new Date('2026-11-21T12:00:00Z');
    const exp = expiraEm(t0);
    expect(exp.getTime() - t0.getTime()).toBe(TTL_CACHE_MS);
    expect(TTL_CACHE_MS).toBe(24 * 3600 * 1000);
    expect(cacheValido(exp, new Date(t0.getTime() + TTL_CACHE_MS - 1))).toBe(true);
    expect(cacheValido(exp, new Date(t0.getTime() + TTL_CACHE_MS))).toBe(false);
  });
});
