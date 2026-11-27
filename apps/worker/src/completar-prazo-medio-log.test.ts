/**
 * R-20261127-024834 (RN-CAD-16): a rotina passa o `log` do worker ao `completarPrazosMedios`, para o aviso do 42501 (contagem de clientes
 * indisponível: tenant_id, condicao_id e codigo, sem dado de cliente) sair no log do worker.
 */
import type { Banco } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

const deps: unknown[] = [];
vi.mock('@macuxierp/cadastros/api', async (original) => ({
  ...(await original<typeof import('@macuxierp/cadastros/api')>()),
  completarPrazosMedios: (d: unknown) => {
    deps.push(d);
    return async () => ({ completadas: 0, corrigidas: 0, clientes_afetados: null });
  },
}));

const { criarRotinaCompletarPrazoMedio } = await import('./completar-prazo-medio');

describe('rotina cadastros.completar-prazo-medio: log ao módulo', () => {
  it('o completarPrazosMedios recebe o mesmo log da rotina', async () => {
    const log = pino({ level: 'silent' });
    const banco = { comTenant: async (_t: string, fn: (tx: unknown) => unknown) => fn({}), semTenant: async () => [], ping: async () => true } as unknown as Banco;
    await criarRotinaCompletarPrazoMedio({ banco, log, tenantsAtivos: async () => [] }).executar(new Date('2026-11-27T07:00:00Z'));
    expect(deps).toHaveLength(1);
    expect((deps[0] as { log?: unknown }).log).toBe(log);
  });
});
