import { describe, expect, it } from 'vitest';
import pacote from '../package.json';
import type { Transacao } from './banco';
import { definirRotaPlataforma } from './plataforma-rotas';
import { executarRotaPlataformaDeTeste, semEspacoDuro } from './testes';

describe('semEspacoDuro (RD-0705)', () => {
  it('troca NBSP (U+00A0) e espaço estreito (U+202F) por espaço comum', () => {
    expect(semEspacoDuro('R$\u00a01.234,56')).toBe('R$ 1.234,56');
    expect(semEspacoDuro('21/11/2026\u202f19:05')).toBe('21/11/2026 19:05');
    expect(semEspacoDuro('a\u00a0b\u202fc\u00a0d')).toBe('a b c d');
    expect(semEspacoDuro('já comum')).toBe('já comum');
  });

  it('null e undefined voltam como estão', () => {
    expect(semEspacoDuro(null)).toBeNull();
    expect(semEspacoDuro(undefined)).toBeUndefined();
  });

  it('sai pelo subcaminho ./testes', () => {
    expect((pacote.exports as Record<string, string>)['./testes']).toBe('./src/testes.ts');
  });
});

describe('executarRotaPlataformaDeTeste (RD-1775)', () => {
  const ID = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
  const OUTRO = '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d';
  const sessao = { superadmin_id: 'sa', sessao_id: 'se' };
  const entrada = (id = ID) => ({ params: { id }, query: undefined, corpo: undefined }) as never;
  const caminho = '/empresas/:id/teste';
  function transacoes(log: string[]) {
    const tx = (papel: string): Transacao => ({ consultar: async () => [{ papel }] as never[] }) as unknown as Transacao;
    return {
      sessao,
      comPlataforma: async <R>(fn: (t: Transacao) => Promise<R>) => (log.push('plataforma'), fn(tx('config'))),
      comTenant: async <R>(t: string, fn: (t: Transacao) => Promise<R>) => (log.push(`tenant:${t}`), fn(tx('app'))),
    };
  }

  it('rota comum: uma transação de plataforma, com tx e auditar', async () => {
    const log: string[] = [];
    const rota = definirRotaPlataforma({
      metodo: 'POST', caminho, acao: 'plataforma.empresa.ver',
      executar: async (c) => ({ corpo: { papel: (await c.tx.consultar<{ papel: string }>('x'))[0]?.papel, sa: c.sessao.superadmin_id, audita: typeof c.auditar } }),
    });
    expect(await executarRotaPlataformaDeTeste(rota, entrada(), transacoes(log))).toEqual({ corpo: { papel: 'config', sa: 'sa', audita: 'function' } });
    expect(log).toEqual(['plataforma']);
  });

  it('rota por etapa: plataforma, depois o tenant do :id, depois plataforma (as regras do executarPlataformaPorEtapa)', async () => {
    const log: string[] = [];
    const rota = definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho, acao: 'plataforma.empresa.ver',
      async executar(c, { params }) {
        await c.comPlataforma(async () => 1);
        const papel = await c.comTenant(params.id!, async (tx) => (await tx.consultar<{ papel: string }>('x'))[0]?.papel);
        await c.comPlataforma(async () => 1);
        return { corpo: { papel } };
      },
    });
    expect(await executarRotaPlataformaDeTeste(rota, entrada(), transacoes(log))).toEqual({ corpo: { papel: 'app' } });
    expect(log).toEqual(['plataforma', `tenant:${ID}`, 'plataforma']);
  });

  it('rota por etapa: tenant que não é o :id, comTenant antes da plataforma ou sem comTenant = erro de programação', async () => {
    const outro = definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho, acao: 'plataforma.empresa.ver',
      executar: async (c) => (await c.comPlataforma(async () => 1), await c.comTenant(OUTRO, async () => 1), {}),
    });
    await expect(executarRotaPlataformaDeTeste(outro, entrada(), transacoes([]))).rejects.toThrow('comTenant só com o tenant do :id');
    const cedo = definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho, acao: 'plataforma.empresa.ver',
      executar: async (c) => (await c.comTenant(ID, async () => 1), {}),
    });
    await expect(executarRotaPlataformaDeTeste(cedo, entrada(), transacoes([]))).rejects.toThrow('comTenant antes da etapa de plataforma');
    const { comTenant: _sem, ...semTenant } = transacoes([]);
    const tenant = definirRotaPlataforma({
      transacoes: 'por_etapa', metodo: 'POST', caminho, acao: 'plataforma.empresa.ver',
      executar: async (c) => (await c.comPlataforma(async () => 1), await c.comTenant(ID, async () => 1), {}),
    });
    await expect(executarRotaPlataformaDeTeste(tenant, entrada(), semTenant)).rejects.toThrow('rota por etapa sem comTenant');
  });
});
