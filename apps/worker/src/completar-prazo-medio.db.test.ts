/**
 * Rotina `cadastros.completar-prazo-medio` (T-0108, decisões 14 A e 16 A) no PostgreSQL real, no papel macuxierp_worker (RLS):
 * a condição vazia com parcelas recebe a média simples arredondada meio para cima, sai o evento
 * `cadastros.condicao_pagamento.alterada@1` na outbox, a auditoria é uma por tenant só com a quantidade, a condição já preenchida
 * e a excluída ficam, e a segunda rodada não acha nada. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { criarRotinaCompletarPrazoMedio } from './completar-prazo-medio';

const AGORA = new Date('2026-11-26T00:10:00Z');

describe.skipIf(!PG_DISPONIVEL)('rotina cadastros.completar-prazo-medio no banco (T-0108)', () => {
  let b: BancoEfemero;
  let A: string;
  let B: string;
  const ids = { a3045: randomUUID(), a285684: randomUUID(), aPreenchida: randomUUID(), aExcluida: randomUUID(), b30: randomUUID() };
  const q = async (sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as Record<string, unknown>[];
  const condicao = (tenant: string, id: string, codigo: string, prazos: number[], medio: number | null, excluida = false) =>
    q(
      `INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias, prazo_medio_dias, deleted_at)
       VALUES ($1, $2, $3, $3, '15', $4, $5, ${excluida ? 'now()' : 'NULL'})`,
      [id, tenant, codigo, prazos, medio],
    );

  beforeAll(async () => {
    b = await criarBancoEfemero();
    A = await criarTenant(b.admin, 'prazo-medio-a', ['cadastros']);
    B = await criarTenant(b.admin, 'prazo-medio-b', ['cadastros']);
    await condicao(A, ids.a3045, '30-45', [30, 45], null);
    await condicao(A, ids.a285684, '28-56-84', [28, 56, 84], null);
    await condicao(A, ids.aPreenchida, '30-60', [30, 60], 40);
    await condicao(A, ids.aExcluida, 'EXC', [10, 20], null, true);
    await condicao(B, ids.b30, '30', [30], null);
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  const medios = async () =>
    Object.fromEntries((await q('SELECT id, prazo_medio_dias FROM cadastros.condicao_pagamento')).map((l) => [l.id as string, l.prazo_medio_dias]));
  const auditorias = (tenant: string) =>
    q(`SELECT depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'condicao_pagamento.completar_prazos_medios'`, [tenant]);

  it('completa as vazias de cada tenant, emite o evento, audita só a quantidade; a segunda rodada não acha nada', async () => {
    const { log, linhas } = pinoEmMemoria();
    const rotina = criarRotinaCompletarPrazoMedio({ banco: b.banco('macuxierp_worker'), log });
    expect(await rotina.executar(AGORA)).toEqual({ tenants: 2, falhas: 0, completadas: 3 });

    const m = await medios();
    expect(m[ids.a3045]).toBe(38); // (30 + 45) / 2 = 37,5 → 38
    expect(m[ids.a285684]).toBe(56);
    expect(m[ids.b30]).toBe(30);
    expect(m[ids.aPreenchida]).toBe(40); // digitada: fica
    expect(m[ids.aExcluida]).toBeNull(); // excluída: fica

    const eventos = await q(
      `SELECT tenant_id, agregado_id FROM plataforma.evento WHERE nome = 'cadastros.condicao_pagamento.alterada@1' ORDER BY agregado_id`,
    );
    expect(eventos.map((e) => e.agregado_id).sort()).toEqual([ids.a3045, ids.a285684, ids.b30].sort());
    expect(await auditorias(A)).toEqual([{ depois: { completadas: 2 } }]);
    expect(await auditorias(B)).toEqual([{ depois: { completadas: 1 } }]);
    expect(linhas.join('')).not.toMatch(/30-45|28-56-84/);

    expect(await rotina.executar(new Date(AGORA.getTime() + 86_400_000))).toEqual({ tenants: 2, falhas: 0, completadas: 0 });
    expect(await auditorias(A)).toHaveLength(1);
    expect(await q(`SELECT count(*)::int AS n FROM plataforma.evento WHERE nome = 'cadastros.condicao_pagamento.alterada@1'`)).toEqual([{ n: 3 }]);
  });
});
