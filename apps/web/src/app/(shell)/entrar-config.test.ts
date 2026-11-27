import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENSAGEM_SEM_ACESSO_CONFIG } from '@macuxierp/platform-sdk';
import type { ResultadoEntrarConfig } from '@/lib/entrar-config';

const m = vi.hoisted(() => ({
  r: { tipo: 'indisponivel' } as ResultadoEntrarConfig,
  refresh: undefined as string | undefined,
  set: vi.fn(),
  redirect: vi.fn((para: string) => { throw new Error(`redirect:${para}`); }),
  chamada: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.refresh ? { value: m.refresh } : undefined), set: m.set }) }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('@/lib/entrar-config', () => ({ entrarConfigPeloBko: async (refresh: string) => { m.chamada(refresh); return m.r; } }));

let acao: typeof import('./entrar-config').entrarConfigAction;
beforeAll(async () => { acao = (await import('./entrar-config')).entrarConfigAction; }, 30_000);
beforeEach(() => { m.set.mockClear(); m.redirect.mockClear(); m.chamada.mockClear(); m.refresh = 'macuxierp_refresh=r1'; });

describe('C1 (45 A): ação "Configuração" do menu', () => {
  it('ok: grava o mx_config (Path=/config, prazo da API) e vai ao /config', async () => {
    m.r = { tipo: 'ok', token: 'tk1', expira_em: new Date(Date.now() + 3_600_000).toISOString() };
    await expect(acao({})).rejects.toThrow('redirect:/config');
    expect(m.chamada).toHaveBeenCalledWith('macuxierp_refresh=r1');
    expect(m.set).toHaveBeenCalledWith('mx_config', 'tk1', expect.objectContaining({ path: '/config', httpOnly: true, sameSite: 'strict' }));
    expect(m.set.mock.calls[0]![2].maxAge).toBeLessThanOrEqual(3600);
  });
  it('401 volta ao login; troca pendente vai à troca de senha', async () => {
    m.r = { tipo: 'sessao' };
    await expect(acao({})).rejects.toThrow('redirect:/login');
    m.r = { tipo: 'trocar_senha' };
    await expect(acao({})).rejects.toThrow(/redirect:\/senha/);
    expect(m.set).not.toHaveBeenCalled();
  });
  it('sem acesso mostra a mensagem do contrato; indisponível, a FALHA', async () => {
    m.r = { tipo: 'sem_acesso', texto: MENSAGEM_SEM_ACESSO_CONFIG };
    expect(await acao({})).toEqual({ erro: MENSAGEM_SEM_ACESSO_CONFIG });
    m.r = { tipo: 'indisponivel' };
    expect((await acao({})).erro).toMatch(/Não foi possível concluir/);
    expect(m.set).not.toHaveBeenCalled();
  });
});
