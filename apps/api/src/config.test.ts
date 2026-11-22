import { describe, expect, it } from 'vitest';
import { lerConfigApi } from './config';

const SEGREDO = 'x'.repeat(40);
const CHAVE_HEX = 'ab'.repeat(32);
const BASE = { MACUXIERP_JWT_SEGREDO: SEGREDO, MACUXIERP_CHAVE_A1: CHAVE_HEX };

describe('configuração da API pelo ambiente', () => {
  it('aplica os padrões (cookie Secure ligado, porta 3000)', () => {
    expect(lerConfigApi(BASE)).toEqual({ jwtSegredo: SEGREDO, porta: 3000, host: '0.0.0.0', versao: 'dev', cookieSeguro: true, poolMax: 10, chaveA1: Buffer.from(CHAVE_HEX, 'hex'), chaveIntegracao: null });
    expect(lerConfigApi({ ...BASE, MACUXIERP_COOKIE_SEGURO: '0', MACUXIERP_PORTA: '8080' })).toMatchObject({ cookieSeguro: false, porta: 8080 });
  });

  it('segredo curto ou ausente recusa a partida, sem o valor na mensagem', () => {
    expect(() => lerConfigApi({})).toThrow(/MACUXIERP_JWT_SEGREDO/);
    let mensagem = '';
    try {
      lerConfigApi({ ...BASE, MACUXIERP_JWT_SEGREDO: 'curto-demais-xyz' });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toContain('MACUXIERP_JWT_SEGREDO');
    expect(mensagem).not.toContain('curto-demais-xyz');
  });

  it('chave do A1 em hex ou base64 de 32 bytes; ausente ou curta recusa a partida, sem o valor na mensagem', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(lerConfigApi({ ...BASE, MACUXIERP_CHAVE_A1: b64 }).chaveA1).toEqual(Buffer.alloc(32, 7));
    expect(() => lerConfigApi({ MACUXIERP_JWT_SEGREDO: SEGREDO })).toThrow(/MACUXIERP_CHAVE_A1/);
    let mensagem = '';
    try {
      lerConfigApi({ ...BASE, MACUXIERP_CHAVE_A1: 'chave-curta-sigilosa' });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toContain('MACUXIERP_CHAVE_A1');
    expect(mensagem).not.toContain('chave-curta-sigilosa');
  });

  it('T-0011: liga MACUXIERP_CHAVE_INTEGRACAO ao chaveIntegracao (ausente = null; formatos e erros no cifra.test.ts)', () => {
    expect(lerConfigApi(BASE).chaveIntegracao).toBeNull();
    expect(lerConfigApi({ ...BASE, MACUXIERP_CHAVE_INTEGRACAO: 'cd'.repeat(32) }).chaveIntegracao).toEqual(Buffer.from('cd'.repeat(32), 'hex'));
  });
});
