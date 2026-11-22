import { describe, expect, it } from 'vitest';
import { executarAutorizado, moduloLicenciado, modulosLicenciados, type Licenca, type Sessao } from './acesso';
import { ErroApi } from './erros';
import { BancoMemoria, tenantDaTx } from './testes';

const INSTANTE = new Date('2026-11-21T15:00:00Z');
const TENANT = '11111111-1111-4111-8111-111111111111';
const sessao = (perfil: Sessao['perfil']): Sessao => ({ usuario_id: '22222222-2222-4222-8222-222222222222', tenant_id: TENANT, perfil, filial_ids: [] });

function cenario(licencas: Licenca[]) {
  const banco = new BancoMemoria();
  const passos: string[] = [];
  const fonte = {
    ler: async (tx: unknown, tenantId: string) => {
      passos.push(`licenca:${tenantId}:${tenantDaTx(tx as never)}`);
      return licencas;
    },
  };
  return { banco, passos, fonte };
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroApi ? `${e.status} ${e.codigo}` : String(e);
  }
}

describe('ordem de checagem (RN-CORE-02)', () => {
  const ativa: Licenca[] = [{ modulo: 'cadastros', ativo: true, valido_ate: null }];

  it('RN-CORE-02: sem sessão é 401 antes de tudo (nem abre transação)', async () => {
    const c = cenario(ativa);
    const r = await codigo(executarAutorizado({ sessao: null, acao: 'cadastros.ver', agora: INSTANTE, banco: c.banco, licencas: c.fonte, executar: async () => 1 }));
    expect(r).toBe('401 NAO_AUTENTICADO');
    expect(c.banco.aberturas).toEqual([]);
  });

  it('RN-CORE-02: perfil sem a ação é 403 PERFIL_SEM_PERMISSAO antes do tenant e da licença', async () => {
    const c = cenario([]); // sem licença: se a ordem estivesse errada, viria MODULO_INATIVO
    const r = await codigo(executarAutorizado({ sessao: sessao('leitura'), acao: 'cadastros.preco.editar', agora: INSTANTE, banco: c.banco, licencas: c.fonte, executar: async () => 1 }));
    expect(r).toBe('403 PERFIL_SEM_PERMISSAO');
    expect(c.banco.aberturas).toEqual([]);
  });

  it('RN-CORE-02: sem licença do módulo é 403 MODULO_INATIVO, lida dentro da transação do tenant', async () => {
    const c = cenario([{ modulo: 'cadastros', ativo: false, valido_ate: null }]);
    let executou = false;
    const r = await codigo(
      executarAutorizado({ sessao: sessao('gerente'), acao: 'cadastros.preco.editar', agora: INSTANTE, banco: c.banco, licencas: c.fonte, executar: async () => { executou = true; } }),
    );
    expect(r).toBe('403 MODULO_INATIVO');
    expect(executou).toBe(false);
    expect(c.passos).toEqual([`licenca:${TENANT}:${TENANT}`]);
  });

  it('RN-CORE-02: com tudo certo executa na transação do tenant da sessão', async () => {
    const c = cenario(ativa);
    const r = await executarAutorizado({ sessao: sessao('faturista'), acao: 'cadastros.cliente.editar', agora: INSTANTE, banco: c.banco, licencas: c.fonte, executar: async (tx) => tenantDaTx(tx) });
    expect(r).toBe(TENANT);
    expect(c.banco.aberturas).toEqual([TENANT]);
  });

  it('rota só de sessão não confere perfil nem licença', async () => {
    const c = cenario([]);
    expect(await executarAutorizado({ sessao: sessao('vendedor'), acao: 'sessao', agora: INSTANTE, banco: c.banco, licencas: c.fonte, executar: async () => 'eu' })).toBe('eu');
    expect(c.passos).toEqual([]);
  });
});

describe('licença por módulo (RF-CORE-03, D12)', () => {
  it('vencida ou inativa não vale; o core é sempre licenciado', () => {
    const l: Licenca[] = [
      { modulo: 'cadastros', ativo: true, valido_ate: new Date('2026-11-21T15:00:01Z') },
      { modulo: 'pedido', ativo: true, valido_ate: new Date('2026-11-21T15:00:00Z') },
      { modulo: 'fiscal', ativo: false, valido_ate: null },
    ];
    expect(moduloLicenciado(l, 'cadastros', INSTANTE)).toBe(true);
    expect(moduloLicenciado(l, 'pedido', INSTANTE)).toBe(false);
    expect(moduloLicenciado(l, 'fiscal', INSTANTE)).toBe(false);
    expect(modulosLicenciados(l, INSTANTE)).toEqual(['core', 'cadastros']);
  });
});
