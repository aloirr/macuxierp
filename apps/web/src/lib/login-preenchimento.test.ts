import { describe, expect, it } from 'vitest';
import { urlEntrarPreenchida } from '@macuxierp/platform-sdk';
import { ROTA_LOGIN } from './rota-login';
import { valoresIniciaisLogin } from './login-preenchimento';

const ini = (fragmento: string) => valoresIniciaisLogin({ fragmento });

describe('login na raiz: valor inicial (ADR 0021, só o e-mail)', () => {
  it('sem fragmento, nada vem preenchido', () => {
    expect(ini('')).toEqual({ email: '' });
  });
  it('o /config sem sessão volta à raiz sem fragmento (sem código da empresa)', () => {
    expect(ROTA_LOGIN).toBe('/');
    expect(ini(new URL(ROTA_LOGIN, 'http://x').hash)).toEqual({ email: '' });
  });
  it('lê o link do SDK sem código (urlEntrarPreenchida); a validação do fragmento é testada no SDK', () => {
    expect(ini(new URL(urlEntrarPreenchida('ana@exemplo.com.br')).hash)).toEqual({ email: 'ana@exemplo.com.br' });
  });
  it('um link antigo com #codigo=… ainda preenche o e-mail e ignora o código', () => {
    const r = ini('#codigo=AM2808&email=a%40b.co');
    expect(r).toEqual({ email: 'a@b.co' });
    expect(r).not.toHaveProperty('empresa');
  });
});
