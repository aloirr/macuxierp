import { TEXTO_CONTA_DESBLOQUEADA } from '@macuxierp/core/web';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eu = vi.hoisted(() => ({ troca: false, motivo: undefined as string | undefined }));
const redirect = vi.hoisted(() => vi.fn((c: string) => { throw new Error(`REDIRECT ${c}`); }));
const trocarSenha = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sessao', async (orig) => ({ ...(await orig<typeof import('@/lib/sessao')>()), contexto: async () => ({ eu: { usuario: { deve_trocar_senha: eu.troca, ...(eu.motivo ? { motivo_troca: eu.motivo } : {}) } }, filial: null }) }));
vi.mock('../(shell)/sair', () => ({ sairAction: vi.fn() }));
const jar = vi.hoisted(() => ({ get: vi.fn((n: string) => (n === 'mx_acesso' ? { value: 'tok' } : n === 'mx_refresh' ? { value: 'macuxierp_refresh=r1' } : undefined)), set: vi.fn(), delete: vi.fn() }));
const renovar = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), trocarSenha, renovar }));

import Senha from './page';
import { trocarSenhaBkoAction } from './acoes';
import { resultadoDaTrocaSenha } from '@/lib/api';

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ok = { senha_atual: 'Provisoria1!', senha_nova: 'Nova-senha-1', confirmacao: 'Nova-senha-1' };

describe('tela /senha do BKO: troca da senha temporária (RN-CORE-13)', () => {
  it('motivo_troca temporaria no eu: sem o campo da senha atual; a ação não manda senha_atual', async () => {
    eu.troca = true; eu.motivo = 'temporaria';
    const h = renderToStaticMarkup(await Senha({ searchParams: Promise.resolve({}) }));
    expect(h).not.toContain('name="senha_atual"');
    expect(h).toContain('name="senha_nova"');
    // T-0111: aviso verde acima do título, rótulos e botão da tela de desbloqueio
    expect(h.indexOf(TEXTO_CONTA_DESBLOQUEADA)).toBeGreaterThan(-1);
    expect(h.indexOf(TEXTO_CONTA_DESBLOQUEADA)).toBeLessThan(h.indexOf('Crie a sua nova senha'));
    expect(h).toContain('aviso-sucesso');
    for (const t of ['Nova senha', 'Repita a nova senha', 'Salvar e entrar']) expect(h).toContain(t);
    expect(h).not.toContain('troque a senha provisória');
    trocarSenha.mockResolvedValue({ ok: true });
    renovar.mockResolvedValue({ acesso: 'a2', refresh: 'macuxierp_refresh=r2' });
    await expect(trocarSenhaBkoAction({}, form({ senha_nova: 'Nova-senha-1', confirmacao: 'Nova-senha-1', destino: '' }))).rejects.toThrow('REDIRECT /');
    expect(trocarSenha).toHaveBeenLastCalledWith('tok', 'macuxierp_refresh=r1', { senha_nova: 'Nova-senha-1' });
    eu.motivo = undefined;
  });
  it('motivo provisoria: o campo da senha atual continua', async () => {
    eu.troca = true; eu.motivo = 'provisoria';
    const h = renderToStaticMarkup(await Senha({ searchParams: Promise.resolve({}) }));
    expect(h).toContain('name="senha_atual"');
    expect(h).not.toContain(TEXTO_CONTA_DESBLOQUEADA);
    eu.motivo = undefined;
  });
});

describe('tela /senha do BKO', () => {
  it('obrigatória: texto da senha provisória, destino vazio, Sair, sem menu e envio bloqueado', async () => {
    eu.troca = true;
    const h = renderToStaticMarkup(await Senha({ searchParams: Promise.resolve({ destino: '/pedido' }) }));
    expect(h).toContain('troque a senha provisória');
    expect(h).toContain('name="destino" value=""');
    expect(h).toContain('>Sair<');
    expect(h).toContain('A senha precisa ter');
    expect(h).toContain('Mostrar senha');
    expect(h).toMatch(/<button class="mx-botao" type="submit" disabled="">Trocar senha/);
    expect(h).not.toContain('class="casca"');
  });
  it('voluntária: sem o texto da provisória e com o destino seguro', async () => {
    eu.troca = false;
    const h = renderToStaticMarkup(await Senha({ searchParams: Promise.resolve({ destino: '/pedido/lista' }) }));
    expect(h).not.toContain('senha provisória');
    expect(h).toContain('name="destino" value="/pedido/lista"');
    const fora = renderToStaticMarkup(await Senha({ searchParams: Promise.resolve({ destino: '//evil.com' }) }));
    expect(fora).toContain('name="destino" value="/"');
  });
});

describe('ação da troca', () => {
  beforeEach(() => { trocarSenha.mockReset(); renovar.mockReset(); jar.set.mockClear(); jar.delete.mockClear(); redirect.mockClear(); renovar.mockResolvedValue({ acesso: 'novo', refresh: 'macuxierp_refresh=r2' }); });

  it('confirmação diferente: "As senhas não conferem. Digite a mesma..." sem chamar a API', async () => {
    const r = await trocarSenhaBkoAction({}, form({ ...ok, confirmacao: 'outra' }));
    expect(r.campos?.confirmacao).toBe('As senhas não conferem. Digite a mesma senha nos dois campos.');
    expect(trocarSenha).not.toHaveBeenCalled();
  });
  it('senha fora da regra: bloqueada no servidor', async () => {
    const r = await trocarSenhaBkoAction({}, form({ ...ok, senha_nova: 'curta', confirmacao: 'curta' }));
    expect(r.campos?.senha_nova).toBeDefined();
    expect(trocarSenha).not.toHaveBeenCalled();
  });
  it('obrigatória (sem destino): troca e vai ao início, sem aviso', async () => {
    trocarSenha.mockResolvedValue({ ok: true });
    await expect(trocarSenhaBkoAction({}, form({ ...ok, destino: '' }))).rejects.toThrow('REDIRECT /');
    expect(trocarSenha).toHaveBeenCalledWith('tok', 'macuxierp_refresh=r1', { senha_atual: 'Provisoria1!', senha_nova: 'Nova-senha-1' });
  });
  it('204: renova pelo refresh e grava os cookies novos de acesso e refresh antes do redirect', async () => {
    trocarSenha.mockResolvedValue({ ok: true });
    await expect(trocarSenhaBkoAction({}, form({ ...ok, destino: '' }))).rejects.toThrow('REDIRECT /');
    expect(renovar).toHaveBeenCalledWith('macuxierp_refresh=r1');
    expect(jar.set).toHaveBeenCalledWith('mx_acesso', 'novo', expect.objectContaining({ httpOnly: true }));
    expect(jar.set).toHaveBeenCalledWith('mx_refresh', 'macuxierp_refresh=r2', expect.objectContaining({ httpOnly: true }));
    expect(jar.delete).not.toHaveBeenCalled();
  });
  it('refresh recusado ou API fora depois do 204: apaga os cookies e vai à raiz', async () => {
    trocarSenha.mockResolvedValue({ ok: true });
    renovar.mockResolvedValueOnce(null);
    await expect(trocarSenhaBkoAction({}, form(ok))).rejects.toThrow(/^REDIRECT \/$/);
    expect(jar.delete).toHaveBeenCalledWith('mx_acesso');
    expect(jar.delete).toHaveBeenCalledWith('mx_refresh');
    expect(jar.set).not.toHaveBeenCalled();
    renovar.mockRejectedValueOnce(new Error('API fora'));
    await expect(trocarSenhaBkoAction({}, form(ok))).rejects.toThrow(/^REDIRECT \/$/);
  });
  it('erro da API não renova e devolve as regras de detalhes.regras', async () => {
    trocarSenha.mockResolvedValue({ ok: false, campos: { senha_nova: 'Um número' }, regras: ['numero'] });
    const r = await trocarSenhaBkoAction({}, form(ok));
    expect(r.regras).toEqual(['numero']);
    expect(renovar).not.toHaveBeenCalled();
  });
  it('voluntária: volta ao destino com o aviso de sucesso', async () => {
    trocarSenha.mockResolvedValue({ ok: true });
    await expect(trocarSenhaBkoAction({}, form({ ...ok, destino: '/pedido/lista?a=1' }))).rejects.toThrow('REDIRECT /pedido/lista?a=1&aviso=senha-trocada');
  });
  it('erro da API volta no campo certo e nunca devolve a senha', async () => {
    trocarSenha.mockResolvedValue({ ok: false, campos: { senha_atual: 'Senha atual incorreta. Confira e digite de novo.' } });
    const r = await trocarSenhaBkoAction({}, form(ok));
    expect(r.campos?.senha_atual).toBe('Senha atual incorreta. Confira e digite de novo.');
    expect(JSON.stringify(r)).not.toContain('Nova-senha-1');
  });
});

describe('mapeamento dos 400 de POST /v1/auth/senha', () => {
  it('204 ok', () => expect(resultadoDaTrocaSenha(204, null)).toEqual({ ok: true }));
  it('senha atual errada em campos.senha_atual', () => {
    expect(resultadoDaTrocaSenha(400, { codigo: 'VALIDACAO', campos: { senha_atual: 'Senha atual incorreta. Confira e digite de novo.' } })).toEqual({ ok: false, campos: { senha_atual: 'Senha atual incorreta. Confira e digite de novo.' } });
  });
  it('fora da regra em campos.senha_nova (rótulos separados por "; ")', () => {
    const r = resultadoDaTrocaSenha(400, { codigo: 'VALIDACAO', campos: { senha_nova: 'Uma letra; Um caractere especial' }, detalhes: { regras: ['letra', 'especial'] } });
    expect(r).toEqual({ ok: false, campos: { senha_nova: 'Uma letra; Um caractere especial' }, regras: ['letra', 'especial'] });
  });
  it('detalhes.regras com id desconhecido ou formato antigo (lista) é ignorado', () => {
    expect(resultadoDaTrocaSenha(400, { campos: { senha_nova: 'x' }, detalhes: { regras: ['xis', 'letra'] } })).toEqual({ ok: false, campos: { senha_nova: 'x' }, regras: ['letra'] });
    expect(resultadoDaTrocaSenha(400, { campos: { senha_nova: 'x' }, detalhes: ['letra'] })).toEqual({ ok: false, campos: { senha_nova: 'x' } });
  });
  it('igual à atual em campos.senha_nova', () => {
    expect(resultadoDaTrocaSenha(400, { campos: { senha_nova: 'A senha nova precisa ser diferente da atual' } })).toEqual({ ok: false, campos: { senha_nova: 'A senha nova precisa ser diferente da atual' } });
  });
  it('outros erros: mensagem fixa, nunca o corpo', () => {
    const r = resultadoDaTrocaSenha(500, { mensagem: 'segredo' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('segredo');
  });
});
