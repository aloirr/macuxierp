/**
 * Rotina `integracao-fdv.expurgo-pre-cadastro` (T-0059, RN-INF-06): registrada no laço diário do worker (8 h UTC), chama a função do
 * módulo, que roda `integracao_fdv.expurgar_pre_cadastro(p_corte)` (recusado e sem decisão, T-0098) em cada tenant ativo com o corte
 * de 180 dias; uma vez por dia (idempotente no laço) e o log leva só contagens.
 */
import { ROTINA_EXPURGO_PRE_CADASTRO } from '@macuxierp/integracao-fdv/api';
import type { Banco, Transacao } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { criarRotinaExpurgoPreCadastro } from './expurgo-pre-cadastro';
import { montarRotinas } from './modulos';
import { DIA_MS, rodarRotinas, type EstadoRotinas } from './rotinas';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d';
const AGORA = new Date('2026-11-24T08:00:00Z');

function bancoDoExpurgo() {
  const chamadas: { tenant: string | null; sql: string; params: unknown[] }[] = [];
  const txDe = (tenant: string | null): Transacao =>
    ({
      consultar: async (sql: string, params: unknown[] = []) => {
        chamadas.push({ tenant, sql: sql.replace(/\s+/g, ' ').trim(), params });
        if (/tenants_ativos/.test(sql)) return [{ id: T1 }, { id: T2 }];
        if (/expurgar_pre_cadastro\(/.test(sql)) return [{ r: { recusado: { revisoes: 2, pre_cadastros: 1 }, sem_decisao: { revisoes: 1, pre_cadastros: 1 } } }];
        return [];
      },
    }) as unknown as Transacao;
  const banco: Banco = { comTenant: async (t, fn) => fn(txDe(t)), semTenant: async (fn) => fn(txDe(null)), ping: async () => true };
  return { banco, chamadas };
}

describe('rotina integracao-fdv.expurgo-pre-cadastro (RN-INF-06)', () => {
  it('está registrada no montarRotinas como diária, às 8 h UTC', () => {
    const { banco } = bancoDoExpurgo();
    const rotina = montarRotinas({ banco, log: pino({ level: 'silent' }) }).find((r) => r.id === ROTINA_EXPURGO_PRE_CADASTRO);
    expect(rotina).toMatchObject({ id: 'integracao-fdv.expurgo-pre-cadastro', horaUtc: 8 });
  });

  it('chama a função do módulo: o expurgo do banco em cada tenant ativo, com o corte de 180 dias, e soma as contagens das duas situações', async () => {
    const { banco, chamadas } = bancoDoExpurgo();
    const { log } = pinoEmMemoria();
    expect(await criarRotinaExpurgoPreCadastro({ banco, log }).executar(AGORA)).toEqual({ tenants: 2, falhas: 0, revisoes: 6, pre_cadastros: 4, recusado_revisoes: 4, recusado_pre_cadastros: 2, sem_decisao_revisoes: 2, sem_decisao_pre_cadastros: 2 });
    expect(chamadas[0]).toMatchObject({ tenant: null, sql: expect.stringContaining('plataforma.tenants_ativos()') });
    const expurgos = chamadas.filter((c) => c.sql.includes('integracao_fdv.expurgar_pre_cadastro('));
    expect(expurgos.map((c) => c.tenant)).toEqual([T1, T2]);
    // O corte vem do domínio do módulo (180 dias, com a folga dele); aqui só a faixa.
    for (const c of expurgos) {
      const corte = (c.params[0] as Date).getTime();
      expect(corte).toBeLessThanOrEqual(AGORA.getTime() - 180 * DIA_MS);
      expect(corte).toBeGreaterThan(AGORA.getTime() - 181 * DIA_MS);
    }
  });

  it('no laço: roda uma vez por dia a partir das 8 h UTC e o log leva só contagens', async () => {
    const { banco, chamadas } = bancoDoExpurgo();
    const { log, registros } = pinoEmMemoria();
    const rotina = criarRotinaExpurgoPreCadastro({ banco, log });
    const estado: EstadoRotinas = new Map();
    expect(await rodarRotinas([rotina], estado, new Date('2026-11-24T07:59:00Z'), log)).toBe(0);
    expect(await rodarRotinas([rotina], estado, AGORA, log)).toBe(1);
    expect(await rodarRotinas([rotina], estado, new Date(AGORA.getTime() + 60 * 60_000), log)).toBe(0);
    expect(chamadas.filter((c) => c.sql.includes('expurgar_pre_cadastro('))).toHaveLength(2);
    const ultima = registros().at(-1)!;
    const { level: _l, time: _t, pid: _p, hostname: _h, msg, ...campos } = ultima;
    expect(msg).toBe('rotina diária concluída');
    expect(campos).toEqual({ rotina: 'integracao-fdv.expurgo-pre-cadastro', tenants: 2, falhas: 0, revisoes: 6, pre_cadastros: 4, recusado_revisoes: 4, recusado_pre_cadastros: 2, sem_decisao_revisoes: 2, sem_decisao_pre_cadastros: 2 });
  });
});
