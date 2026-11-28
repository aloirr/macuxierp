import { describe, expect, it } from 'vitest';
import { CODIGO_SUPERADMIN_LOGIN, urlEntrarPreenchida } from '@macuxierp/platform-sdk';
import { ROTA_LOGIN_SUPERADMIN } from './rota-login';
import { valoresIniciaisLogin } from './login-preenchimento';

const ini = (fragmento: string, salvo?: string) => valoresIniciaisLogin({ salvo, fragmento });

describe('login na raiz: valores iniciais', () => {
  it('sem fragmento, segue o código salvo do BKO', () => {
    expect(ini('', 'AM2808')).toEqual({ empresa: 'AM2808', email: '' });
    expect(ini('', undefined)).toEqual({ empresa: '', email: '' });
  });
  it('o /config sem sessão volta à raiz com o código da plataforma, vencendo o código salvo do BKO', () => {
    expect(ROTA_LOGIN_SUPERADMIN.startsWith('/#')).toBe(true);
    expect(ini(new URL(ROTA_LOGIN_SUPERADMIN, 'http://x').hash, 'AM2808')).toEqual({ empresa: CODIGO_SUPERADMIN_LOGIN, email: '' });
  });
});

describe('v0.3.20 C2 (44 B): link do e-mail preenche código e e-mail pelo fragmento', () => {
  it('lê o link do SDK (urlEntrarPreenchida); a validação do fragmento é testada no SDK', () => {
    expect(ini(new URL(urlEntrarPreenchida('AM2808', 'ana@exemplo.com.br')).hash)).toEqual({ empresa: 'AM2808', email: 'ana@exemplo.com.br' });
  });
  it('o fragmento vence o código salvo', () => {
    expect(ini('#codigo=AM2808&email=a%40b.co', 'OUTRA')).toEqual({ empresa: 'AM2808', email: 'a@b.co' });
  });
});
