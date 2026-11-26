/**
 * T-0108, RN-CAD-15 (decisão 14 A): `completarPrazosMedios` completa o prazo médio das condições já gravadas com ele vazio, no PostgreSQL
 * real, papel macuxierp_app, com RLS. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 * O teste marcado "(0068)" precisa da coluna `prazo_medio_calculado` (migração 0068 do banco-dados) e se pulam sem ela.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { AuditoriaPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { completarPrazosMedios } from './completar-prazos-medios';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const AGORA = new Date('2026-11-25T15:00:00Z');
const gerente = sessaoDe('gerente');
const NOME_EVENTO = 'cadastros.condicao_pagamento.alterada@1';

describe.skipIf(!PG_DISPONIVEL)('completarPrazosMedios (T-0108, decisões 14 A e 17 B, PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let comMarca = false;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rotina = completarPrazosMedios({ repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
  const rodar = (tenant: string) => app.comTenant(tenant, (tx: Transacao) => rotina(tx, tenant));
  const amb = (tenant: string) => criarAmbiente(
    criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), AGORA, transacaoDe(app, tenant),
  );
  const inserir = async (tenant: string, codigo: string, prazos: number[], extra: { medio?: number | null; excluida?: boolean } = {}) =>
    (await admin(
      `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, prazo_medio_dias, deleted_at)
       VALUES ($1, $2, $3, '15', $4::int[], $5, ${extra.excluida ? 'now()' : 'NULL'}) RETURNING id`,
      [tenant, codigo, `Descricao ${codigo}`, prazos, extra.medio ?? null],
    ))[0]!.id as string;
  const medio = async (id: string) => (await admin('SELECT prazo_medio_dias FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]!.prazo_medio_dias as number | null;
  const eventos = (tenant: string) => admin('SELECT nome, agregado_id, payload FROM plataforma.evento WHERE tenant_id = $1 AND nome = $2 ORDER BY id', [tenant, NOME_EVENTO]);
  const auditorias = (tenant: string) => admin("SELECT usuario_id, entidade, depois, antes FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'condicao_pagamento.completar_prazos_medios'", [tenant]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'completar-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'completar-b', ['cadastros']);
    comMarca = (await admin("SELECT 1 FROM information_schema.columns WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento' AND column_name = 'prazo_medio_calculado'")).length > 0;
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-15 (decisão 14 A): grava a média meio para cima; o digitado e a excluída ficam como estão', async () => {
    const t = await criarTenant(efemero.admin, 'completar-media', ['cadastros']);
    const a = await inserir(t, 'M1', [30, 45]);
    const digitado = await inserir(t, 'D0', [30, 60], { medio: 0 });
    const excluida = await inserir(t, 'X1', [30, 60], { excluida: true });
    expect(await rodar(t)).toEqual({ completadas: 1 });
    expect([await medio(a), await medio(digitado), await medio(excluida)]).toEqual([38, 0, null]);
  }, 120_000);

  it('RN-CAD-15 (decisão 14 A): sem parcelas continua null e não conta (o banco já recusa parcelas vazias; a rotina também as ignora)', async () => {
    const t = await criarTenant(efemero.admin, 'completar-sem-parcela', ['cadastros']);
    await expect(inserir(t, 'S0', [])).rejects.toThrow(); // CHECK cardinality(prazos_dias) >= 1
    const ok = await inserir(t, 'S1', [30]);
    // condição fictícia sem parcelas devolvida pela consulta: continua sem prazo e não é gravada nem contada
    const semParcelas = { id: '00000000-0000-4000-8000-000000000000', prazos_dias: [], prazo_medio_dias: null };
    const repos = (tx: Transacao) => { const r = repositoriosSql(tx); return { ...r, carga: { ...r.carga, condicoesAtivasSemPrazoMedio: async () => [semParcelas, ...(await r.carga.condicoesAtivasSemPrazoMedio())] } } as typeof r; };
    const comFalsa = completarPrazosMedios({ repositorios: repos, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    expect(await app.comTenant(t, (tx) => comFalsa(tx, t))).toEqual({ completadas: 1 });
    expect(await medio(ok)).toBe(30);
    expect(await eventos(t)).toHaveLength(1);
  }, 120_000);

  it('T-0108: evento igual ao do PATCH (tipo e campos do payload), um por condição completada', async () => {
    const t = await criarTenant(efemero.admin, 'completar-evento', ['cadastros']);
    const id = await inserir(t, 'E1', [30, 60]);
    const outra = await inserir(t, 'E2', [10]);
    expect(await rodar(t)).toEqual({ completadas: 2 });
    const evs = await eventos(t);
    expect(evs.map((e) => e.agregado_id).sort()).toEqual([id, outra].sort());
    const ev = evs.find((e) => e.agregado_id === id)!;
    expect(ev.nome).toBe(NOME_EVENTO);
    const corpo = (ev.payload as { payload: Record<string, unknown>; ator: string }).payload;
    expect((ev.payload as { ator: string }).ator).toBe('sistema');
    expect(corpo).toMatchObject({ id, codigo: 'E1', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45, inativo: false });
    // o evento do PATCH, para uma condição equivalente: mesmos campos do payload
    const a = amb(t);
    const criada = await a.chamar('POST', '/condicoes-pagamento', { sessao: gerente, corpo: { codigo: 'E3', descricao: 'D', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 } });
    expect(criada.status).toBe(201);
    const idPatch = (criada.corpo as { id: string }).id;
    expect((await a.chamar('PATCH', `/condicoes-pagamento/${idPatch}`, { sessao: gerente, corpo: { descricao: 'D2' } })).status).toBe(200);
    const doPatch = a.eventos.at(-1)!;
    expect(doPatch.nome).toBe(NOME_EVENTO);
    expect(Object.keys(corpo).sort()).toEqual(Object.keys(doPatch.payload as object).sort());
  }, 120_000);

  it('T-0108: auditoria única por tenant, só com a quantidade; com 0 não grava; a 2ª rodada dá 0', async () => {
    const t = await criarTenant(efemero.admin, 'completar-auditoria', ['cadastros']);
    await inserir(t, 'U1', [30, 60]);
    await inserir(t, 'U2', [15]);
    expect(await rodar(t)).toEqual({ completadas: 2 });
    const aud = await auditorias(t);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: null, entidade: 'condicao_pagamento', depois: { completadas: 2 } });
    expect(JSON.stringify(aud)).not.toMatch(/U1|U2|Descricao/); // sem código nem descrição
    expect(await rodar(t)).toEqual({ completadas: 0 });
    expect(await auditorias(t)).toHaveLength(1);
    expect(await eventos(t)).toHaveLength(2);
  }, 120_000);

  it('T-0108: isolamento entre tenants: a rodada do A não toca o B', async () => {
    const a = await inserir(A, 'I1', [30, 60]);
    const b = await inserir(B, 'I1', [30, 60]);
    expect(await rodar(A)).toEqual({ completadas: 1 });
    expect(await medio(a)).toBe(45);
    expect(await medio(b)).toBeNull();
    expect(await eventos(B)).toHaveLength(0);
    expect(await auditorias(B)).toHaveLength(0);
    expect(await rodar(B)).toEqual({ completadas: 1 });
    expect(await medio(b)).toBe(45);
  }, 120_000);

  it('decisão 17 B (0068): a rotina grava a marca prazo_medio_calculado = true; o digitado fica com false', async (ctx) => {
    if (!comMarca) return ctx.skip();
    const t = await criarTenant(efemero.admin, 'completar-marca', ['cadastros']);
    const a = await inserir(t, 'K1', [30, 60]);
    const d = await inserir(t, 'K2', [30, 60], { medio: 10 });
    await rodar(t);
    const marca = async (id: string) => (await admin('SELECT prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE id = $1', [id]))[0]!.prazo_medio_calculado as boolean | null;
    expect(await marca(a)).toBe(true);
    expect(await marca(d)).not.toBe(true);
  }, 120_000);
});
