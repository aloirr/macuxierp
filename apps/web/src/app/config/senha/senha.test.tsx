import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }));
const trocar = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/config/sessao', () => ({ exigirTokenConfig: async () => 'tok' }));
vi.mock('@/lib/config/api', () => ({ trocarSenhaPlataforma: trocar }));
vi.mock('@/lib/config/executar', () => ({ executarConfig: async (_c: string, fn: (t: string) => Promise<unknown>) => ({ ok: true, valor: await fn('tok') }) }));

import Senha from './page';
import { trocarSenhaAcao } from './acoes';
import { ErroPlataforma, mensagemDoErro } from '@/lib/config/erros';

const form = (a: string, n: string, c = n) => { const f = new FormData(); f.set('senha_atual', a); f.set('senha_nova', n); f.set('confirmacao', c); return f; };

describe('/config/senha com a regra única (T-0052)', () => {
  beforeEach(() => { trocar.mockClear(); redirect.mockClear(); });

  it('tela: lista de regras, olho e envio bloqueado; sem a regra antiga de 14 caracteres', async () => {
    const h = renderToStaticMarkup(await Senha());
    for (const t of ['A senha precisa ter', '8 caracteres ou mais', 'Uma letra', 'Um número', 'Um caractere especial', 'Mostrar senha', 'Confirme a senha nova']) expect(h).toContain(t);
    expect(h).not.toContain('14 caracteres');
    expect(h).toMatch(/disabled=""[^>]*>Definir senha/);
  });
  it('senha de 8 caracteres com letra, número e especial passa (antes exigia 14)', async () => {
    await expect(trocarSenhaAcao({}, form('Provisoria#1', 'abcdef1!'))).rejects.toThrow('REDIRECT /config');
    expect(trocar).toHaveBeenCalledWith('tok', { senha_atual: 'Provisoria#1', senha_nova: 'abcdef1!' });
  });
  it('confirmação diferente: "As senhas não conferem. Digite a mesma..." sem chamar a API', async () => {
    const r = await trocarSenhaAcao({}, form('Provisoria#1', 'abcdef1!', 'outra'));
    expect(r.campos?.confirmacao).toBe('As senhas não conferem. Digite a mesma senha nos dois campos.');
    expect(trocar).not.toHaveBeenCalled();
  });
  it('sem especial: recusada sem chamar a API', async () => {
    expect((await trocarSenhaAcao({}, form('Provisoria#1', 'abcdefg1'))).erro).toBe('Um caractere especial');
    expect(trocar).not.toHaveBeenCalled();
  });
  it('400 da API: mostra o texto de campos (senha atual ou senha igual) e cai na mensagem antiga sem campos', () => {
    const t = (campos: Record<string, string>) => mensagemDoErro(new ErroPlataforma(400, 'VALIDACAO', campos), 'senha').texto;
    expect(t({ senha_atual: 'Senha atual incorreta. Confira e digite de novo.' })).toBe('Senha atual incorreta. Confira e digite de novo.');
    expect(t({ senha_nova: 'A senha nova precisa ser diferente da atual' })).toBe('A senha nova precisa ser diferente da atual');
    expect(t({})).toContain('incorreta');
  });
});
