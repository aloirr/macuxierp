import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/cadastros/clientes' }));

import { MenuUsuario, hrefAlterarSenha } from './menu-usuario';

describe('T-0139: botão do usuário no topo', () => {
  const html = renderToStaticMarkup(<MenuUsuario nome="Ana Souza" detalhe="Administrador" hrefPerfil="/perfil" hrefSenha="/senha" comDestino sair={() => undefined} />);
  it('botão com aria-expanded fechado, nome, perfil e iniciais', () => {
    expect(html).toMatch(/aria-haspopup="menu"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-haspopup="menu"/);
    expect(html).toContain('Ana Souza');
    expect(html).toContain('Administrador');
    expect(html).toContain('>AS<');
  });
  it('itens: Ver perfil, Alterar senha (com destino) e Sair, sem Ajuda', () => {
    expect(html).toContain('href="/perfil"');
    expect(html).toContain('href="/senha?destino=%2Fcadastros%2Fclientes"');
    expect(html).toMatch(/type="submit"[^>]*>Sair</);
    expect(html).not.toContain('Ajuda');
    expect(html).not.toContain('Trocar senha');
  });
  it('/config não leva destino', () => {
    expect(hrefAlterarSenha('/config/senha', '/config', false)).toBe('/config/senha');
    expect(hrefAlterarSenha('/senha', '/', true)).toBe('/senha');
  });
});
