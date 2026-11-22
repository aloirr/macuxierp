import { describe, expect, it } from 'vitest';
import { lerConfigApi } from './config';

const SEGREDO = 'x'.repeat(40);

describe('configuração da API pelo ambiente', () => {
  it('aplica os padrões (cookie Secure ligado, porta 3000)', () => {
    expect(lerConfigApi({ MACUXIERP_JWT_SEGREDO: SEGREDO })).toEqual({ jwtSegredo: SEGREDO, porta: 3000, host: '0.0.0.0', versao: 'dev', cookieSeguro: true, poolMax: 10 });
    expect(lerConfigApi({ MACUXIERP_JWT_SEGREDO: SEGREDO, MACUXIERP_COOKIE_SEGURO: '0', MACUXIERP_PORTA: '8080' })).toMatchObject({ cookieSeguro: false, porta: 8080 });
  });

  it('segredo curto ou ausente recusa a partida, sem o valor na mensagem', () => {
    expect(() => lerConfigApi({})).toThrow(/MACUXIERP_JWT_SEGREDO/);
    let mensagem = '';
    try {
      lerConfigApi({ MACUXIERP_JWT_SEGREDO: 'curto-demais-xyz' });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toContain('MACUXIERP_JWT_SEGREDO');
    expect(mensagem).not.toContain('curto-demais-xyz');
  });
});
