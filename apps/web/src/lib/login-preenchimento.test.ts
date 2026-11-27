import { describe, expect, it } from 'vitest';
import { CODIGO_SUPERADMIN_LOGIN } from '@macuxierp/platform-sdk';
import { ROTA_ENTRAR } from '@/lib/config/constantes';
import { destinoSeguro } from '@/lib/sessao';
import { lerFragmentoLogin, valoresIniciaisLogin } from './login-preenchimento';

describe('v0.3.20 B: /config manda ao login com destino da plataforma (R-20261127-061730)', () => {
  it('o /config vai a /login com destino=/config, aceito pelo destinoSeguro', () => {
    const u = new URL(ROTA_ENTRAR, 'https://x.invalid');
    expect(u.pathname).toBe('/login');
    expect(destinoSeguro(u.searchParams.get('destino'))).toBe('/config');
  });
  it('com destino no /config, o campo Empresa vem com o código da plataforma, nunca o último código do BKO', () => {
    expect(valoresIniciaisLogin({ destino: '/config', salvo: 'AM2808', fragmento: '' })).toEqual({ empresa: CODIGO_SUPERADMIN_LOGIN, email: '' });
    expect(valoresIniciaisLogin({ destino: '/config/empresas/1', salvo: 'AM2808', fragmento: '' }).empresa).toBe(CODIGO_SUPERADMIN_LOGIN);
  });
  it('fora do /config, segue o código salvo do BKO', () => {
    expect(valoresIniciaisLogin({ destino: '/', salvo: 'AM2808', fragmento: '' })).toEqual({ empresa: 'AM2808', email: '' });
    expect(valoresIniciaisLogin({ destino: '/', salvo: undefined, fragmento: '' })).toEqual({ empresa: '', email: '' });
  });
});

describe('v0.3.20 C2 (44 B): link do e-mail preenche código e e-mail pelo fragmento', () => {
  it('lê #codigo=…&email=… (decodificado); nunca a senha', () => {
    expect(lerFragmentoLogin('#codigo=AM2808&email=ana%40exemplo.com.br')).toEqual({ codigo: 'AM2808', email: 'ana@exemplo.com.br' });
    expect(lerFragmentoLogin('#codigo=AM2808&email=a%40b.co&senha=x')).toEqual({ codigo: 'AM2808', email: 'a@b.co' });
    expect(lerFragmentoLogin('')).toEqual({});
    expect(lerFragmentoLogin('#lixo')).toEqual({});
  });
  it('valor inválido não entra (código fora do formato, e-mail sem @)', () => {
    expect(lerFragmentoLogin('#codigo=%3Cscript%3E&email=nao-e-email')).toEqual({});
  });
  it('o fragmento vence o código salvo; sem destino /config', () => {
    expect(valoresIniciaisLogin({ destino: '/', salvo: 'OUTRA', fragmento: '#codigo=AM2808&email=a%40b.co' })).toEqual({ empresa: 'AM2808', email: 'a@b.co' });
  });
});
