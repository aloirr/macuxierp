import { CodigoEmpresaLogin } from '@macuxierp/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const set = vi.hoisted(() => vi.fn());
const loginUnico = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }));
const buscarEu = vi.hoisted(() => vi.fn());
const euPlataforma = vi.hoisted(() => vi.fn());
vi.mock('@/lib/login-unico', () => ({ loginUnico }));
vi.mock('@/lib/api', () => ({ buscarEu }));
vi.mock('@/lib/config/api', () => ({ euPlataforma }));

import { entrarAction } from './entrar';

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const ok = { empresa: ' am2808 ', email: 'A@B.co', senha: 'Segredo#1' };
const bko = { destino: 'bko' as const, acesso: 'a', refresh: 'macuxierp_refresh=r' };
const config = { destino: 'config' as const, token: 'tok', expira_em: '2026-11-23T20:00:00.000Z' };

describe('login único: navegação pelo destino que a API devolve', () => {
  beforeEach(() => { set.mockClear(); loginUnico.mockReset(); buscarEu.mockReset(); euPlataforma.mockReset(); buscarEu.mockResolvedValue({ usuario: {} }); euPlataforma.mockResolvedValue({ deve_trocar_senha: false }); });

  it('manda código normalizado e e-mail em minúsculas; destino bko vai ao destino seguro e grava os cookies do BKO', async () => {
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: bko });
    await expect(entrarAction(form({ ...ok, destino: '/pedido' }))).resolves.toEqual({ entrou: { destino: 'bko', para: '/pedido' } });
    expect(loginUnico).toHaveBeenCalledWith({ empresa: 'AM2808', email: 'a@b.co', senha: 'Segredo#1' });
    expect(set.mock.calls.map((c) => c[0])).toEqual(['mx_acesso', 'mx_refresh']);
  });
  it('destino config vai a /config e grava só o cookie do superadmin', async () => {
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: config });
    await expect(entrarAction(form({ ...ok, destino: '/pedido' }))).resolves.toEqual({ entrou: { destino: 'config', para: '/config' } });
    expect(set.mock.calls.map((c) => c[0])).toEqual(['mx_config']);
  });
  it('troca pendente no eu do BKO (provisória ou temporária): vai a /senha, sem ?motivo na URL', async () => {
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: bko });
    buscarEu.mockResolvedValue({ usuario: { deve_trocar_senha: true, motivo_troca: 'provisoria' } });
    await expect(entrarAction(form(ok))).resolves.toEqual({ entrou: { destino: 'bko', para: '/senha' } });
    buscarEu.mockResolvedValue({ usuario: { deve_trocar_senha: true, motivo_troca: 'temporaria' } });
    await expect(entrarAction(form(ok))).resolves.toEqual({ entrou: { destino: 'bko', para: '/senha' } });
    expect(buscarEu).toHaveBeenCalledWith('a');
    expect(set.mock.calls.map((c) => c[0])).toContain('mx_refresh');
  });
  it('troca pendente no eu da plataforma: vai a /config/senha, sem ?motivo na URL', async () => {
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: config });
    euPlataforma.mockResolvedValue({ deve_trocar_senha: true, motivo_troca: 'temporaria' });
    await expect(entrarAction(form(ok))).resolves.toEqual({ entrou: { destino: 'config', para: '/config/senha' } });
    expect(euPlataforma).toHaveBeenCalledWith('tok');
    expect(buscarEu).not.toHaveBeenCalled();
  });
  it('eu sem troca pendente ou fora do ar: segue ao destino normal', async () => {
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: bko });
    buscarEu.mockRejectedValue(new Error('fora'));
    await expect(entrarAction(form(ok))).resolves.toEqual({ entrou: { destino: 'bko', para: '/' } });
    loginUnico.mockResolvedValue({ tipo: 'ok', sessao: config });
    await expect(entrarAction(form(ok))).resolves.toEqual({ entrou: { destino: 'config', para: '/config' } });
  });
  it('401 neutro, sem dizer qual campo', async () => {
    loginUnico.mockResolvedValue({ tipo: 'credencial' });
    expect(await entrarAction(form(ok))).toEqual({ erro: 'Empresa, e-mail ou senha incorretos.' });
    expect(set).not.toHaveBeenCalled();
  });
  it('423 (CONTA_BLOQUEADA): conta bloqueada, sem texto de erro (T-0111), também para o superadmin', async () => {
    loginUnico.mockResolvedValue({ tipo: 'bloqueada' });
    expect(await entrarAction(form(ok))).toEqual({ bloqueada: true });
    const sa = form({ ...ok, empresa: 'MACUXI' });
    expect(await entrarAction(sa)).toEqual({ bloqueada: true });
    expect(set).not.toHaveBeenCalled();
  });
  it('429 do IP: Muitas tentativas com o prazo, sem o cartão de conta bloqueada', async () => {
    loginUnico.mockResolvedValue({ tipo: 'limite', retry_after_s: 420 });
    const r = await entrarAction(form(ok));
    expect(r.bloqueada).toBeUndefined();
    expect(r.erro).toContain('Muitas tentativas');
    expect(set).not.toHaveBeenCalled();
  });
  it('serviço indisponível; 400 da API vira erro de campo', async () => {
    loginUnico.mockResolvedValue({ tipo: 'indisponivel' });
    expect(await entrarAction(form(ok))).toEqual({ erro: 'Serviço indisponível no momento. Tente de novo em instantes.' });
    loginUnico.mockResolvedValue({ tipo: 'campos', erros: { email: 'E-mail inválido' } });
    expect(await entrarAction(form(ok))).toEqual({ campos: { email: 'E-mail inválido' } });
  });
  it('campos vazios ou inválidos voltam por campo, sem chamar a API', async () => {
    expect(await entrarAction(form({ empresa: '', email: '', senha: '' }))).toEqual({
      campos: { empresa: 'Informe o código da empresa.', email: 'Informe o e-mail.', senha: 'Informe a senha.' },
    });
    const r = await entrarAction(form({ empresa: 'a!', email: 'x', senha: 'y' }));
    expect(r.campos?.empresa).toBe(CodigoEmpresaLogin.safeParse('a!').error?.issues[0]?.message);
    expect(r.campos?.email).toBe('E-mail inválido. Confira o endereço.');
    expect(loginUnico).not.toHaveBeenCalled();
  });
});
