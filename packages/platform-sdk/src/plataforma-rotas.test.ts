import { describe, expect, it } from 'vitest';
import { ErroApi } from './erros';
import {
  ACOES_PLATAFORMA,
  definirPluginPlataforma,
  definirRotaPlataforma,
  executarPlataforma,
  executarPlataformaPorEtapa,
  type BancoPlataforma,
  type BancoTenantPlataforma,
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

const TENANT = '44444444-4444-4444-8444-444444444444';
const OUTRO_TENANT = '55555555-5555-4555-8555-555555555555';

/** Dublês que registram a ordem das aberturas e fechamentos (um log só para os dois bancos). */
function bancosPorEtapa() {
  const log: string[] = [];
  const banco: BancoPlataforma = {
    async comPlataforma(sessao, fn) {
      log.push(`plataforma:abre:${sessao.sessao_id}`);
      try {
        return await fn({ consultar: async () => [{ papel: 'macuxierp_config' }] as never[] });
      } finally {
        log.push('plataforma:fecha');
      }
    },
  };
  const bancoTenant: BancoTenantPlataforma = {
    async comTenant(tenantId, fn) {
      log.push(`tenant:abre:${tenantId}`);
      try {
        return await fn({ consultar: async () => [{ papel: 'macuxierp_app', tenant: tenantId }] as never[] });
      } finally {
        log.push('tenant:fecha');
      }
    },
  };
  return { log, banco, bancoTenant };
}

const pedido = (b: ReturnType<typeof bancosPorEtapa>, extra: Partial<Parameters<typeof executarPlataformaPorEtapa>[0]> = {}) => ({
  sessao: SESSAO,
  banco: b.banco,
  bancoTenant: b.bancoTenant,
  tenantDaRota: TENANT,
  request_id: 'req-1',
  agora: new Date('2026-11-23T19:10:00Z'),
  executar: async () => undefined,
  ...extra,
});

describe('rota por etapa (T-0058, ADR 0013 adendo): comTenant da carga do portal', () => {
  it('as 3 transações saem uma depois da outra; o comTenant abre transação NOVA no banco de tenant, com o tenant da rota', async () => {
    const b = bancosPorEtapa();
    const r = await executarPlataformaPorEtapa(
      pedido(b, {
        executar: async (c) => {
          await c.comPlataforma((tx) => tx.consultar('SELECT cadastros.portal_carga_iniciar($1, $2, $3, $4)'));
          const lido = await c.comTenant(TENANT, (tx) => tx.consultar<{ papel: string; tenant: string }>('SELECT 1'));
          await c.comPlataforma((tx) => tx.consultar('SELECT cadastros.portal_carga_concluir($1, $2, $3, $4, $5)'));
          return lido[0];
        },
      }),
    );
    expect(r).toEqual({ papel: 'macuxierp_app', tenant: TENANT });
    expect(b.log).toEqual([
      `plataforma:abre:${SESSAO.sessao_id}`,
      'plataforma:fecha',
      `tenant:abre:${TENANT}`,
      'tenant:fecha',
      `plataforma:abre:${SESSAO.sessao_id}`,
      'plataforma:fecha',
    ]);
  });

  it('sem sessão é 401 e nenhum banco abre', async () => {
    const b = bancosPorEtapa();
    await expect(executarPlataformaPorEtapa(pedido(b, { sessao: null, executar: async (c) => c.comPlataforma(async () => 1) }))).rejects.toMatchObject({ status: 401 });
    expect(b.log).toEqual([]);
  });

  it('comTenant antes da etapa de plataforma, com outro tenant ou com id que não é UUID: erro de programação, sem abrir', async () => {
    const b = bancosPorEtapa();
    await expect(executarPlataformaPorEtapa(pedido(b, { executar: (c) => c.comTenant(TENANT, async () => 1) }))).rejects.toThrow(/antes da etapa/);
    await expect(
      executarPlataformaPorEtapa(pedido(b, { executar: async (c) => (await c.comPlataforma(async () => 1), c.comTenant(OUTRO_TENANT, async () => 1)) })),
    ).rejects.toThrow(/tenant do :id/);
    await expect(executarPlataformaPorEtapa(pedido(b, { tenantDaRota: 'x', executar: (c) => c.comTenant('x', async () => 1) }))).rejects.toThrow(/tenant do :id/);
    expect(b.log.filter((l) => l.startsWith('tenant'))).toEqual([]);
  });

  it('nunca uma transação dentro da outra (nem em paralelo): o comTenant fica fora da transação de plataforma', async () => {
    const b = bancosPorEtapa();
    await expect(
      executarPlataformaPorEtapa(pedido(b, { executar: async (c) => (await c.comPlataforma(async () => 1), c.comPlataforma(() => c.comTenant(TENANT, async () => 1))) })),
    ).rejects.toThrow(/dentro de outra/);
    await expect(
      executarPlataformaPorEtapa(
        pedido(b, { executar: async (c) => (await c.comPlataforma(async () => 1), Promise.all([c.comTenant(TENANT, async () => 1), c.comTenant(TENANT, async () => 2)])) }),
      ),
    ).rejects.toThrow(/dentro de outra/);
  });

  it('o prazo da rota embrulha só a transação de tenant', async () => {
    const b = bancosPorEtapa();
    const embrulhadas: string[] = [];
    await executarPlataformaPorEtapa(
      pedido(b, {
        prazoTenant: (tx) => {
          embrulhadas.push('tenant');
          return tx;
        },
        executar: async (c) => {
          await c.comPlataforma(async () => 1);
          await c.comTenant(TENANT.toUpperCase(), async () => 1);
          await c.comPlataforma(async () => 1);
        },
      }),
    );
    expect(embrulhadas).toEqual(['tenant']);
  });

  it('o plugin recusa rota por etapa fora de /empresas/:id/, com Idempotency-Key ou prazo fora do limite, e prazo em rota comum', () => {
    const porEtapa = (caminho: string, extra: Record<string, unknown> = {}) =>
      definirRotaPlataforma({ metodo: 'POST', caminho, acao: 'plataforma.cadastros.carga', transacoes: 'por_etapa', executar: async () => ({}), ...extra });
    expect(() => definirPluginPlataforma([porEtapa('/cargas')])).toThrow(PluginInvalido);
    expect(() => definirPluginPlataforma([porEtapa('/empresas/:id/cadastros/cargas/:cadastro/gravar', { idempotencia: 'opcional' })])).toThrow(PluginInvalido);
    expect(() => definirPluginPlataforma([porEtapa('/empresas/:id/cadastros/cargas/:cadastro/gravar', { tempoMaximoMs: 999 })])).toThrow(PluginInvalido);
    expect(() =>
      definirPluginPlataforma([definirRotaPlataforma({ metodo: 'POST', caminho: '/empresas', acao: 'plataforma.empresa.criar', tempoMaximoMs: 5_000, executar: async () => ({}) } as never)]),
    ).toThrow(PluginInvalido);
    expect(definirPluginPlataforma([porEtapa('/empresas/:id/cadastros/cargas/:cadastro/gravar', { tempoMaximoMs: 120_000 })]).rotas).toHaveLength(1);
  });

  it('multipart na rota de plataforma segue as regras do BKO (só escrita, campo válido, limite até o teto)', () => {
    const comArquivo = (metodo: 'GET' | 'POST', tamanhoMaximo: number) =>
      definirRotaPlataforma({ metodo, caminho: '/empresas/:id/x', acao: 'plataforma.cadastros.carga', multipart: { arquivos: [{ campo: 'arquivos', tamanhoMaximo }] }, executar: async () => ({}) });
    expect(() => definirPluginPlataforma([comArquivo('GET', 1_000)])).toThrow(PluginInvalido);
    expect(() => definirPluginPlataforma([comArquivo('POST', 11 * 1_048_576)])).toThrow(PluginInvalido);
    expect(definirPluginPlataforma([comArquivo('POST', 10 * 1_048_576)]).rotas).toHaveLength(1);
  });
});
