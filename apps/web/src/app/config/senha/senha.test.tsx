import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }));
const trocar = vi.hoisted(() => vi.fn(async () => undefined));
const eu = vi.hoisted(() => ({ motivo: undefined as string | undefined, falha: false }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/config/sessao', () => ({ exigirTokenConfig: async () => 'tok' }));
vi.mock('@/lib/config/api', () => ({
  trocarSenhaPlataforma: trocar,
  euPlataforma: async () => { if (eu.falha) throw new Error('fora'); return { superadmin: { id: 'x', nome: 'S' }, deve_trocar_senha: true, ...(eu.motivo ? { motivo_troca: eu.motivo } : {}), sessao_expira_em: '2026-11-24T00:00:00.000Z' }; },
}));
vi.mock('@/lib/config/executar', () => ({ executarConfig: async (_c: string, fn: (t: string) => Promise<unknown>) => ({ ok: true, valor: await fn('tok') }) }));

import Senha from './page';
import { trocarSenhaAcao } from './acoes';
import { ErroPlataforma, mensagemDoErro } from '@/lib/config/erros';

const form = (a: string, n: string, c = n) => { const f = new FormData(); f.set('senha_atual', a); f.set('senha_nova', n); f.set('confirmacao', c); return f; };

describe('/config/senha com a regra única (T-0052)', () => {
  beforeEach(() => { trocar.mockClear(); redirect.mockClear(); eu.motivo = undefined; eu.falha = false; });

  it('tela: lista de regras, olho e envio bloqueado; sem a regra antiga de 14 caracteres', async () => {
    const h = renderToStaticMarkup(await Senha());
    for (const t of ['A senha precisa ter', '8 caracteres ou mais', 'Uma letra', 'Um número', 'Um caractere especial', 'Mostrar senha', 'Confirme a senha nova']) expect(h).toContain(t);
    expect(h).not.toContain('14 caracteres');
    expect(h).toMatch(/disabled=""[^>]*>Definir senha/);
  });
  it('provisória: pede a senha provisória atual', async () => {
    eu.motivo = 'provisoria';
    const h = renderToStaticMarkup(await Senha());
    expect(h).toContain('name="senha_atual"');
    expect(h).toContain('Senha provisória atual');
  });
  it('T-0094: um olho só (na senha nova), oculta; autoComplete certo em cada campo', async () => {
    eu.motivo = 'provisoria';
    const h = renderToStaticMarkup(await Senha());
    expect(h.match(/aria-label="Mostrar senha"/g)).toHaveLength(1);
    expect(h.match(/type="password"/g)).toHaveLength(3);
    expect(h.match(/autoComplete="current-password"/g)).toHaveLength(1);
    expect(h.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(h).toContain('aria-describedby="regras-lista"');
  });
  it('temporária (motivo_troca do eu): sem o campo da senha atual, sem ?motivo na URL', async () => {
    eu.motivo = 'temporaria';
    const h = renderToStaticMarkup(await Senha());
    expect(h).not.toContain('name="senha_atual"');
    expect(h).toContain('name="senha_nova"');
    // T-0111 (superadmin): "Conta desbloqueada." acima do título
    expect(h.indexOf('Conta desbloqueada.')).toBeGreaterThan(-1);
    expect(h.indexOf('Conta desbloqueada.')).toBeLessThan(h.indexOf('Crie a sua nova senha'));
  });
  it('provisória: sem "Conta desbloqueada."', async () => {
    eu.motivo = 'provisoria';
    expect(renderToStaticMarkup(await Senha())).not.toContain('Conta desbloqueada.');
  });
  it('eu fora do ar: segue com o campo da senha atual', async () => {
    eu.falha = true;
    expect(renderToStaticMarkup(await Senha())).toContain('name="senha_atual"');
  });
  it('temporária: a ação não manda senha_atual', async () => {
    const f = new FormData(); f.set('senha_nova', 'abcdef1!'); f.set('confirmacao', 'abcdef1!');
    await expect(trocarSenhaAcao({}, f)).rejects.toThrow('REDIRECT /config');
    expect(trocar).toHaveBeenCalledWith('tok', { senha_nova: 'abcdef1!' });
  });
  it('senha_atual presente mas vazia: recusada sem chamar a API', async () => {
    expect((await trocarSenhaAcao({}, form('', 'abcdef1!'))).erro).toBeTruthy();
    expect(trocar).not.toHaveBeenCalled();
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
