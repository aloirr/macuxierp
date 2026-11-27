import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MENSAGEM_SEM_ACESSO_CONFIG } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ usePathname: () => '/', redirect: vi.fn() }));
vi.mock('./entrar-config', () => ({ entrarConfigAction: vi.fn() }));

let NavLateral: typeof import('./nav-lateral').NavLateral;
let Visao: typeof import('./item-configuracao').VisaoItemConfiguracao;
let ROTULO: string;
beforeAll(async () => {
  NavLateral = (await import('./nav-lateral')).NavLateral;
  ({ VisaoItemConfiguracao: Visao, ROTULO_CONFIGURACAO: ROTULO } = await import('./item-configuracao'));
}, 30_000);

describe('C1 (45 A): item "Configuração" no menu do BKO', () => {
  it('aparece só com acesso_config === true, em Conta, como botão (POST)', () => {
    const com = renderToStaticMarkup(<NavLateral menu={[]} acessoConfig />);
    expect(com).toMatch(new RegExp(`<button class="item-menu" type="submit"[^>]*>${ROTULO}</button>`));
    expect(com.indexOf('Licenças')).toBeLessThan(com.indexOf(ROTULO));
    expect(renderToStaticMarkup(<NavLateral menu={[]} />)).not.toContain(ROTULO);
  });
  it('a recusa aparece logo abaixo do botão; enviando, o botão fica desabilitado', () => {
    const h = renderToStaticMarkup(<Visao erro={MENSAGEM_SEM_ACESSO_CONFIG} />);
    expect(h.indexOf('</button>')).toBeLessThan(h.indexOf(MENSAGEM_SEM_ACESSO_CONFIG));
    expect(renderToStaticMarkup(<Visao pendente />)).toMatch(/<button[^>]*disabled/);
    expect(renderToStaticMarkup(<Visao />)).not.toContain(MENSAGEM_SEM_ACESSO_CONFIG);
  });
});
