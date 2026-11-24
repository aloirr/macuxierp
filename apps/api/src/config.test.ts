import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lerConfigApi } from './config';

const SEGREDO = 'x'.repeat(40);
const CHAVE_HEX = 'ab'.repeat(32);
const BASE = { MACUXIERP_JWT_SEGREDO: SEGREDO, MACUXIERP_CHAVE_A1: CHAVE_HEX };

describe('configuração da API pelo ambiente', () => {
  it('aplica os padrões (cookie Secure ligado, porta 3000)', () => {
    expect(lerConfigApi(BASE)).toEqual({ jwtSegredo: SEGREDO, porta: 3000, host: '0.0.0.0', versao: 'dev', cookieSeguro: true, poolMax: 10, chaveA1: Buffer.from(CHAVE_HEX, 'hex'), chaveIntegracao: null, segredoBff: null, email: { transporte: 'desligado' }, avisos: [] });
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

    /** Confere que o e-mail desligou e que os avisos citam os nomes esperados, sem os valores do SMTP nem os `proibidos`. */
    function desligouCom(env: NodeJS.ProcessEnv, nomes: string[], proibidos: string[] = []) {
      const cfg = lerConfigApi(env);
      expect(cfg.email).toEqual({ transporte: 'desligado' });
      const texto = cfg.avisos.join('\n');
      for (const nome of nomes) expect(texto).toContain(nome);
      for (const valor of [...Object.values(SMTP), ...proibidos]) expect(texto).not.toContain(valor);
      return cfg.avisos;
    }

    it('sem host e sem transporte explícito = desligado, sem aviso (vazio conta como ausente)', () => {
      expect(lerConfigApi({ ...BASE, MACUXI_SMTP_HOST: '', MACUXI_EMAIL_TRANSPORTE: '', MACUXI_SMTP_SENHA: '' })).toMatchObject({ email: { transporte: 'desligado' }, avisos: [] });
    });

    it('transporte arquivo ou desligado explícito vence o host', () => {
      expect(lerConfigApi({ ...BASE, MACUXI_EMAIL_TRANSPORTE: 'arquivo' })).toMatchObject({ email: { transporte: 'arquivo' }, avisos: [] });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_EMAIL_TRANSPORTE: 'desligado' })).toMatchObject({ email: { transporte: 'desligado' }, avisos: [] });
    });

    it('smtp completo: porta 587 e starttls por padrão; tls por padrão só na 465; MACUXI_SMTP_TLS explícito vence', () => {
      expect(lerConfigApi({ ...BASE, ...SMTP })).toMatchObject({ email: { transporte: 'smtp', host: 'smtp.exemplo.test', porta: 587, tls: false, usuario: 'usuario-ficticio', senha: 'senha-ficticia-sigilosa', remetente: 'nao-responda@exemplo.test' }, avisos: [] });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '465' }).email).toMatchObject({ porta: 465, tls: true });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '465', MACUXI_SMTP_TLS: 'tls' }).email).toMatchObject({ porta: 465, tls: true });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '465', MACUXI_SMTP_TLS: 'starttls' }).email).toMatchObject({ porta: 465, tls: false });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '587', MACUXI_SMTP_TLS: 'starttls' }).email).toMatchObject({ porta: 587, tls: false });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: '587', MACUXI_SMTP_TLS: 'tls' }).email).toMatchObject({ porta: 587, tls: true });
      expect(lerConfigApi({ ...BASE, ...SMTP, MACUXI_SMTP_TLS: 'tls', MACUXI_EMAIL_TRANSPORTE: 'smtp', MACUXI_SMTP_PORTA: '' }).email).toMatchObject({ porta: 587, tls: true });
    });

    it('smtp sem senha (ausente ou vazia) sobe com o e-mail desligado e aviso só com o nome MACUXI_SMTP_SENHA', () => {
      const { MACUXI_SMTP_SENHA: _s, ...semSenha } = SMTP;
      const avisos = desligouCom({ ...BASE, ...semSenha }, ['MACUXI_SMTP_SENHA']);
      expect(avisos).toEqual(['e-mail desligado: MACUXI_SMTP_SENHA ausente (obrigatória com o transporte smtp)']);
      desligouCom({ ...BASE, ...SMTP, MACUXI_SMTP_SENHA: '' }, ['MACUXI_SMTP_SENHA']);
    });

    it('transporte smtp sem host, sem usuário ou sem remetente desliga o e-mail com um aviso por variável', () => {
      const { MACUXI_SMTP_HOST: _h, MACUXI_SMTP_USUARIO: _u, MACUXI_SMTP_REMETENTE: _r, ...soSenha } = SMTP;
      expect(desligouCom({ ...BASE, ...soSenha, MACUXI_EMAIL_TRANSPORTE: 'smtp' }, ['MACUXI_SMTP_HOST', 'MACUXI_SMTP_USUARIO', 'MACUXI_SMTP_REMETENTE'])).toHaveLength(3);
    });

    it('TLS, porta ou transporte fora do formato desligam o e-mail com aviso que cita o nome, nunca o valor', () => {
      expect(desligouCom({ ...BASE, ...SMTP, MACUXI_SMTP_TLS: 'talvez' }, ['MACUXI_SMTP_TLS'], ['talvez'])).toHaveLength(1);
      for (const tls of ['TLS', 'STARTTLS', '1', '"tls"']) {
        expect(desligouCom({ ...BASE, ...SMTP, MACUXI_SMTP_TLS: tls }, ['MACUXI_SMTP_TLS'])).toEqual(['e-mail desligado: MACUXI_SMTP_TLS fora do formato (use tls ou starttls)']);
      }
      for (const porta of ['abc', '70000', '0', '58 7', '"587"', '-1', '587.0']) {
        expect(desligouCom({ ...BASE, ...SMTP, MACUXI_SMTP_PORTA: porta }, ['MACUXI_SMTP_PORTA'], [porta])).toEqual(['e-mail desligado: MACUXI_SMTP_PORTA fora do formato (só dígitos, de 1 a 65535)']);
      }
      expect(desligouCom({ ...BASE, ...SMTP, MACUXI_EMAIL_TRANSPORTE: 'pombo-correio' }, ['MACUXI_EMAIL_TRANSPORTE'], ['pombo-correio'])).toEqual(['e-mail desligado: MACUXI_EMAIL_TRANSPORTE fora do formato (use smtp, arquivo ou desligado)']);
      expect(desligouCom({ ...BASE, ...SMTP, MACUXI_EMAIL_TRANSPORTE: 'SMTP' }, ['MACUXI_EMAIL_TRANSPORTE'])).toHaveLength(1);
    });
  });
});
