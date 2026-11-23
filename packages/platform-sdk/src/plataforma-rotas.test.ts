import { describe, expect, it } from 'vitest';
import { ErroApi } from './erros';
import {
  ACOES_PLATAFORMA,
  definirPluginPlataforma,
  definirRotaPlataforma,
  executarPlataforma,
  type BancoPlataforma,
  type SessaoPlataforma,
} from './plataforma-rotas';
import { PluginInvalido } from './rotas';

const SESSAO: SessaoPlataforma = { superadmin_id: '22222222-2222-4222-8222-222222222222', sessao_id: '33333333-3333-4333-8333-333333333333' };
const tx = { consultar: async () => [] };

function bancoQueConta(): BancoPlataforma & { aberturas: string[] } {
  const aberturas: string[] = [];
  return {
    aberturas,
    async comPlataforma(sessao, fn) {
      aberturas.push(sessao.sessao_id);
      return fn(tx);
    },
  };
}

const rota = (metodo: 'GET' | 'POST', caminho: string, acao: (typeof ACOES_PLATAFORMA)[number]) =>
  definirRotaPlataforma({ metodo, caminho, acao, executar: async () => ({ status: 200 }) });

describe('rotas de plataforma (ADR 0012): superadmin no lugar de perfil + licença do tenant', () => {
  it('sem sessão de superadmin é 401 e o banco nem abre', async () => {
    const banco = bancoQueConta();
    await expect(executarPlataforma({ sessao: null, banco, executar: async () => 1 })).rejects.toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' });
    expect(banco.aberturas).toEqual([]);
  });

  it('com sessão, executa dentro da transação de plataforma aberta com a sessão (o banco revalida nas funções SECURITY DEFINER)', async () => {
    const banco = bancoQueConta();
    expect(await executarPlataforma({ sessao: SESSAO, banco, executar: async (_tx, s) => s.superadmin_id })).toBe(SESSAO.superadmin_id);
    expect(banco.aberturas).toEqual([SESSAO.sessao_id]);
  });

  it('as ações são do prefixo plataforma.* e nunca se confundem com as ações de tenant', () => {
    for (const a of ACOES_PLATAFORMA) expect(a.startsWith('plataforma.')).toBe(true);
  });

  it('revelar o e-mail do 1º admin é ação explícita e auditada (T-0050)', () => {
    expect(ACOES_PLATAFORMA).toContain('plataforma.admin.revelar_email');
  });

  it('o plugin recusa caminho sem "/", o login dentro do plugin (é da apps/api), rota repetida e idempotência em GET', () => {
    expect(() => definirPluginPlataforma([rota('GET', 'empresas', 'plataforma.empresa.ver')])).toThrow(PluginInvalido);
    expect(() => definirPluginPlataforma([rota('POST', '/auth/entrar', 'plataforma.empresa.ver')])).toThrow(PluginInvalido);
    expect(() => definirPluginPlataforma([rota('GET', '/empresas', 'plataforma.empresa.ver'), rota('GET', '/empresas', 'plataforma.empresa.ver')])).toThrow(PluginInvalido);
    expect(() =>
      definirPluginPlataforma([definirRotaPlataforma({ metodo: 'GET', caminho: '/empresas', acao: 'plataforma.empresa.ver', idempotencia: 'opcional', executar: async () => ({}) })]),
    ).toThrow(PluginInvalido);
    expect(definirPluginPlataforma([rota('GET', '/empresas', 'plataforma.empresa.ver'), rota('POST', '/empresas', 'plataforma.empresa.criar')]).rotas).toHaveLength(2);
  });

  it('ErroApi continua o tipo do erro (o handler da apps/api traduz igual às rotas de módulo)', async () => {
    await expect(executarPlataforma({ sessao: null, banco: bancoQueConta(), executar: async () => 1 })).rejects.toBeInstanceOf(ErroApi);
  });
});
