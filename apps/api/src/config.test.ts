import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lerConfigApi } from './config';

const SEGREDO = 'x'.repeat(40);
const CHAVE_HEX = 'ab'.repeat(32);
const BASE = { MACUXIERP_JWT_SEGREDO: SEGREDO, MACUXIERP_CHAVE_A1: CHAVE_HEX };

describe('configuração da API pelo ambiente', () => {
  it('aplica os padrões (cookie Secure ligado, porta 3000)', () => {
    expect(lerConfigApi(BASE)).toEqual({ jwtSegredo: SEGREDO, porta: 3000, host: '0.0.0.0', versao: 'dev', cookieSeguro: true, poolMax: 10, chaveA1: Buffer.from(CHAVE_HEX, 'hex'), chaveIntegracao: null, segredoBff: null, email: { transporte: 'desligado' } });
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

  it('T-0050: MACUXIERP_SEGREDO_BFF opcional (ausente ou vazio = null); fora de 64 hex recusa a partida, sem o valor na mensagem', () => {
    const segredo = randomBytes(32).toString('hex');
    expect(lerConfigApi(BASE).segredoBff).toBeNull();
    expect(lerConfigApi({ ...BASE, MACUXIERP_SEGREDO_BFF: '' }).segredoBff).toBeNull();
    expect(lerConfigApi({ ...BASE, MACUXIERP_SEGREDO_BFF: segredo }).segredoBff).toBe(segredo);
    for (const invalido of [segredo.slice(2), `${segredo.slice(2)}zz`, 'prova-curta-sigilosa']) {
      let mensagem = '';
      try {
        lerConfigApi({ ...BASE, MACUXIERP_SEGREDO_BFF: invalido });
      } catch (e) {
        mensagem = (e as Error).message;
      }
      expect(mensagem).toContain('MACUXIERP_SEGREDO_BFF');
      expect(mensagem).not.toContain(invalido);
    }
  });

  describe('T-0076: e-mail transacional (MACUXI_EMAIL_TRANSPORTE e MACUXI_SMTP_*)', () => {
    const SMTP = { MACUXI_SMTP_HOST: 'smtp.exemplo.test', MACUXI_SMTP_USUARIO: 'usuario-ficticio', MACUXI_SMTP_SENHA: 'senha-ficticia-sigilosa', MACUXI_SMTP_REMETENTE: 'nao-responda@exemplo.test' };

    function mensagemDe(env: NodeJS.ProcessEnv): string {
      try {
        lerConfigApi(env);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    }

    it('sem host e sem transporte explícito = desligado (vazio conta como ausente)', () => {
      expect(lerConfigApi({ ...BASE, MACUXI_SMTP_HOST: '', MACUXI_EMAIL_TRANSPORTE: '', MACUXI_SMTP_SENHA: '' }).email).toEqual({ transporte: 'desligado' });
    });

    it('transporte arquivo ou desligado explícito vence o host', () => {
      expect(lerConfigApi({ ...BASE, MACUXI_EMAIL_TRANSPORTE: 'arquivo' }).email).toEqual({ transporte: 'arquivo' });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_EMAIL_TRANSPORTE: 'desligado' }).email).toEqual({ transporte: 'desligado' });
    });

    it('smtp completo: porta 587 e STARTTLS por padrão; TLS implícito por padrão só na 465; MACUXI_SMTP_TLS explícito vence', () => {
      expect(lerConfigApi({ ...BASE, ...SMTP }).email).toEqual({ transporte: 'smtp', host: 'smtp.exemplo.test', porta: 587, tls: false, usuario: 'usuario-ficticio', senha: 'senha-ficticia-sigilosa', remetente: 'nao-responda@exemplo.test' });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '465' }).email).toMatchObject({ porta: 465, tls: true });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '465', MACUXI_SMTP_TLS: '0' }).email).toMatchObject({ tls: false });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_TLS: '1', MACUXI_EMAIL_TRANSPORTE: 'smtp', MACUXI_SMTP_PORTA: '' }).email).toMatchObject({ porta: 587, tls: true });
    });

    it('host sem senha recusa a partida citando só MACUXI_SMTP_SENHA, sem valor nenhum na mensagem', () => {
      const { MACUXI_SMTP_SENHA: _s, ...semSenha } = SMTP;
      const mensagem = mensagemDe({ ...BASE, ...semSenha });
      expect(mensagem).toContain('MACUXI_SMTP_SENHA');
      expect(mensagem).not.toMatch(/MACUXI_SMTP_(HOST|USUARIO|REMETENTE)/);
      for (const valor of Object.values(semSenha)) expect(mensagem).not.toContain(valor);
      expect(mensagemDe({ ...BASE, ...SMTP, MACUXI_SMTP_SENHA: '' })).toContain('MACUXI_SMTP_SENHA');
    });

    it('transporte smtp sem host, transporte ou TLS inválidos recusam a partida, sem o valor na mensagem', () => {
      const { MACUXI_SMTP_HOST: _h, ...semHost } = SMTP;
      expect(mensagemDe({ ...BASE, ...semHost, MACUXI_EMAIL_TRANSPORTE: 'smtp' })).toContain('MACUXI_SMTP_HOST');
      const transporte = mensagemDe({ ...BASE, MACUXI_EMAIL_TRANSPORTE: 'pombo-correio' });
      expect(transporte).toContain('MACUXI_EMAIL_TRANSPORTE');
      expect(transporte).not.toContain('pombo-correio');
      const tls = mensagemDe({ ...BASE, ...SMTP, MACUXI_SMTP_TLS: 'talvez' });
      expect(tls).toContain('MACUXI_SMTP_TLS');
      expect(tls).not.toContain('talvez');
      expect(mensagemDe({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '70000' })).toContain('MACUXI_SMTP_PORTA');
    });
  });
});
