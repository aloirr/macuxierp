/**
 * Rotina `sefaz_simulador.purga` (T-0045 §9): todos os tenants da fonte (inclusive desativados), corte de 400 dias, contagens somadas, falha de
 * um tenant não para os outros e o log leva só contagens; sem a `plataforma.tenants_todos()` (42883), pendente com um aviso por dia. A rodada
 * real (RLS, tenant suspenso) está em `purga-simulador.db.test.ts`.
 */
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { TodosTenantsPg } from '@macuxierp/platform-sdk/pg';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { criarRotinaPurgaSimulador, RETENCAO_SIMULADOR_DIAS } from './purga-simulador';
import { DIA_MS, rodarRotinas, type EstadoRotinas } from './rotinas';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d';
const T3 = '2f8d8c6a-5e3b-4dab-9f4c-7b9aaebc3d4e';
const AGORA = new Date('2026-11-22T07:00:00Z');

/** Erro do `pg` com SQLSTATE (o `BancoPg` repassa o erro do driver como está). */
const erroPg = (code: string) => Object.assign(new Error('erro do banco'), { code });

function bancoDaPurga(falhaEm?: string, falhaDaLista?: Error) {
  const chamadas: { tenant: string | null; sql: string; params: unknown[] }[] = [];
  const txDe = (tenant: string | null): Transacao =>
    ({
      consultar: async (sql: string, params: unknown[] = []) => {
        chamadas.push({ tenant, sql: sql.replace(/\s+/g, ' ').trim(), params });
        if (tenant === falhaEm) throw new Error('falha simulada');
        if (/tenants_todos/.test(sql)) {
          if (falhaDaLista) throw falhaDaLista;
          return [{ id: T1 }, { id: T2 }, { id: T3 }];
        }
        if (/DELETE FROM sefaz_simulador\.(evento|nota)/.test(sql)) return [{ n: '2' }];
        return [{ n: '1' }];
      },
    }) as unknown as Transacao;
  const banco: Banco = { comTenant: async (t, fn) => fn(txDe(t)), semTenant: async (fn) => fn(txDe(null)), ping: async () => true };
  return { banco, chamadas };
}

describe('rotina sefaz_simulador.purga', () => {
  it('apaga em cada tenant da fonte o que tem mais de 400 dias, soma as contagens e segue quando um tenant falha', async () => {
    const { banco, chamadas } = bancoDaPurga(T2);
    const { log, registros } = pinoEmMemoria();
    const rotina = criarRotinaPurgaSimulador({ banco, tenants: new TodosTenantsPg(), log });
    expect(rotina).toMatchObject({ id: 'sefaz_simulador.purga', horaUtc: 7 });
    expect(await rotina.executar(AGORA)).toEqual({ tenants: 3, notas: 4, eventos: 4, inutilizacoes: 2, recibos: 2, falhas: 1 });
    // A lista sai sem tenant; a purga, na transação de cada tenant, com o corte de 400 dias.
    expect(chamadas[0]).toMatchObject({ tenant: null, sql: expect.stringContaining('plataforma.tenants_todos()') });
    const corte = new Date(AGORA.getTime() - RETENCAO_SIMULADOR_DIAS * DIA_MS);
    const deletes = chamadas.filter((c) => c.sql.includes('DELETE FROM sefaz_simulador'));
    expect(new Set(deletes.map((c) => c.tenant))).toEqual(new Set([T1, T2, T3]));
    expect(deletes.every((c) => (c.params[0] as Date).getTime() === corte.getTime())).toBe(true);
    expect(corte.toISOString()).toBe('2025-10-18T07:00:00.000Z');
    expect(registros()).toEqual([expect.objectContaining({ rotina: 'sefaz_simulador.purga', tenant_id: T2, erro: 'ErroEstadoSimuladorPg' })]);
  });

  it('no laço das rotinas: o log da rodada leva só as contagens', async () => {
    const { banco } = bancoDaPurga();
    const { log, registros } = pinoEmMemoria();
    const rotina = criarRotinaPurgaSimulador({ banco, tenants: { todos: async () => [T1] }, log });
    expect(await rodarRotinas([rotina], new Map(), AGORA, log)).toBe(1);
    const [linha] = registros();
    const { level: _l, time: _t, pid: _p, hostname: _h, msg, ...campos } = linha!;
    expect(msg).toBe('rotina diária concluída');
    expect(campos).toEqual({ rotina: 'sefaz_simulador.purga', tenants: 1, notas: 2, eventos: 2, inutilizacoes: 1, recibos: 1, falhas: 0 });
  });

  it('sem a plataforma.tenants_todos() (42883): pendente, um warn só no dia, rotina concluída e nada apagado', async () => {
    const { banco, chamadas } = bancoDaPurga(undefined, erroPg('42883'));
    const { log, registros } = pinoEmMemoria();
    const rotina = criarRotinaPurgaSimulador({ banco, tenants: new TodosTenantsPg(), log });
    const estado: EstadoRotinas = new Map();
    expect(await rodarRotinas([rotina], estado, AGORA, log)).toBe(1);
    // 15 min e 1 h depois, no mesmo dia: não roda de novo (nem warn nem error a cada 15 min).
    expect(await rodarRotinas([rotina], estado, new Date(AGORA.getTime() + 15 * 60_000), log)).toBe(0);
    expect(await rodarRotinas([rotina], estado, new Date(AGORA.getTime() + 60 * 60_000), log)).toBe(0);
    expect(chamadas.some((c) => c.sql.includes('DELETE'))).toBe(false);
    const linhas = registros();
    expect(linhas.filter((l) => (l.level as number) === 40)).toEqual([expect.objectContaining({ rotina: 'sefaz_simulador.purga', pendente: 'plataforma.tenants_todos()' })]);
    expect(linhas.filter((l) => (l.level as number) >= 50)).toEqual([]);
    expect(linhas.at(-1)).toMatchObject({ msg: 'rotina diária concluída', rotina: 'sefaz_simulador.purga', tenants: 0, pendente: 1 });
  });

  it('outro erro da lista (não 42883) continua falhando a rotina: log.error e nova tentativa em 15 min', async () => {
    const { banco } = bancoDaPurga(undefined, erroPg('57P01'));
    const { log, registros } = pinoEmMemoria();
    const estado: EstadoRotinas = new Map();
    expect(await rodarRotinas([criarRotinaPurgaSimulador({ banco, tenants: new TodosTenantsPg(), log })], estado, AGORA, log)).toBe(0);
    expect(registros()).toEqual([expect.objectContaining({ level: 50, rotina: 'sefaz_simulador.purga', msg: 'rotina diária falhou' })]);
    expect(estado.get('sefaz_simulador.purga')).toEqual({ tentarApos: AGORA.getTime() + 15 * 60_000 });
  });
});
