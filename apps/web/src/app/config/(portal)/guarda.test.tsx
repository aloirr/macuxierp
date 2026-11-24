import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ jar: {} as Record<string, string>, eu: undefined as unknown, falha: undefined as unknown }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (estado.jar[n] ? { value: estado.jar[n] } : undefined), delete: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT ${d}`);
  },
}));
vi.mock('@/lib/config/api', () => ({
  euPlataforma: async () => {
    if (estado.falha) throw estado.falha;
    return estado.eu;
  },
  sairPlataforma: vi.fn(),
}));

import { ConfigNaoAutenticado, ErroPlataforma } from '@/lib/config/erros';
import CascaPlataforma from './layout';

const EU = { superadmin: { id: '1', nome: 'Operação' }, deve_trocar_senha: false, sessao_expira_em: '2026-11-23T20:00:00.000Z' };
const abrir = () => CascaPlataforma({ children: null });

beforeEach(() => {
  estado.jar = {};
  estado.eu = EU;
  estado.falha = undefined;
});

describe('guarda do grupo /config (layout)', () => {
  it('sem sessão de superadmin: redireciona ao login da plataforma (caminho relativo)', async () => {
    await expect(abrir()).rejects.toThrow('REDIRECT /login');
  });
  it('token recusado pela API (401): limpa o cookie pela rota de encerramento', async () => {
    estado.jar = { mx_config: 'velho' };
    estado.falha = new ConfigNaoAutenticado();
    await expect(abrir()).rejects.toThrow('REDIRECT /config/sessao/encerrar');
  });
  it('senha provisória do operador ainda não trocada: só a tela de troca', async () => {
    estado.jar = { mx_config: 'tok' };
    estado.eu = { ...EU, deve_trocar_senha: true };
    await expect(abrir()).rejects.toThrow('REDIRECT /config/senha');
    estado.eu = EU;
    estado.falha = new ErroPlataforma(403, CODIGO_TROCAR_SENHA);
    await expect(abrir()).rejects.toThrow('REDIRECT /config/senha');
  });
  it('com sessão válida abre o portal', async () => {
    estado.jar = { mx_config: 'tok' };
    await expect(abrir()).resolves.toBeTruthy();
  });
});

describe('páginas do portal têm guarda própria', () => {
  it('criar empresa sem sessão: redireciona ao login, sem depender do layout', async () => {
    const { default: NovaEmpresa } = await import('./empresas/nova/page');
    await expect(NovaEmpresa()).rejects.toThrow('REDIRECT /login');
    estado.jar = { mx_config: 'tok' };
    await expect(NovaEmpresa()).resolves.toBeTruthy();
  });
});
