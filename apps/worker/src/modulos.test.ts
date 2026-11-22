/**
 * Ligação do worker (T-0035, T-0040): `montarRotinas` e `montarExecutores` usam os adaptadores SQL do core. Um banco
 * que só grava o SQL prova o caminho sem PostgreSQL; a rodada real fica em `modulos.db.test.ts`.
 */
import { exportadorCore } from '@macuxierp/core/api';
import { TRABALHO_EXPORTAR } from '@macuxierp/core/contracts';
import { ArmazenamentoMemoria, type Banco, type Transacao } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { EXPORTADORES, montarExecutores, montarRotinas } from './modulos';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const CERT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILIAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const AGORA = new Date('2026-11-21T11:00:00Z');

/** Banco que grava o SQL de cada consulta e responde pelo primeiro trecho que casar. */
function bancoGravador(respostas: [RegExp, unknown[]][]) {
  const sql: string[] = [];
  const tx: Transacao = {
    consultar: async <T>(texto: string) => {
      sql.push(texto.replace(/\s+/g, ' ').trim());
      return (respostas.find(([re]) => re.test(texto))?.[1] ?? []) as T[];
    },
  } as Transacao;
  const banco: Banco = { comTenant: async (_t, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };
  return { banco, sql };
}

const log = pino({ level: 'silent' });

describe('worker: rotinas e executores com os adaptadores reais', () => {
  it('RF-CORE-04: uma rotina, o alerta do A1 às 11 h UTC (7 h em Manaus), pelos adaptadores SQL do core', async () => {
    const { banco, sql } = bancoGravador([
      [/tenants_ativos/, [{ id: T1 }]],
      [/FROM core\.certificado/, [{ id: CERT, filial_id: FILIAL, valido_ate: new Date('2026-12-01T00:00:00Z') }]],
      [/INSERT INTO core\.aviso_a1/, [{ id: 'novo' }]],
    ]);
    const rotinas = montarRotinas({ banco, log });
    expect(rotinas.map((r) => [r.id, r.horaUtc])).toEqual([['core.alerta_a1', 11]]);
    expect(await rotinas[0]!.executar(AGORA)).toEqual({ tenants: 1, avisos: 1, repetidos: 0, falhas: 0 });
    expect(sql).toEqual([
      expect.stringContaining('plataforma.tenants_ativos()'),
      expect.stringContaining('FROM core.certificado'),
      expect.stringContaining('INSERT INTO core.aviso_a1'),
    ]);
    // regras 8 e 9: nenhuma consulta lê o .pfx, a senha do A1 nem o titular
    expect(sql.join('\n')).not.toMatch(/pfx_cifrado|senha_cifrada|titular/);
  });

  it('RF-CORE-06: um executor, a exportação LGPD, com o registro SQL do core e o exportador do core', async () => {
    const { banco, sql } = bancoGravador([[/SELECT estado FROM core\.exportacao/, [{ estado: 'pronta' }]]]);
    const executores = montarExecutores({ banco, log, armazenamento: new ArmazenamentoMemoria(), catalogo: { inserir: async () => undefined }, agora: () => AGORA });
    expect(executores.map((e) => e.tipo)).toEqual([TRABALHO_EXPORTAR]);
    expect(EXPORTADORES).toEqual([exportadorCore]);
    const id = '10000000-0000-4000-8000-000000000001';
    const r = await banco.comTenant(T1, (tx) => executores[0]!.executar({ id, tipo: TRABALHO_EXPORTAR, tenant_id: T1, payload: { exportacao_id: id }, tentativas: 0 }, tx));
    // já pronta: não gera de novo (idempotente), e quem respondeu foi a core.exportacao
    expect(r).toEqual({ exportacao_id: id, estado: 'pronta' });
    expect(sql).toEqual([expect.stringContaining('FROM core.exportacao')]);
  });
});
