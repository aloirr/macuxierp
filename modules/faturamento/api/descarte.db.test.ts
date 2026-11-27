/**
 * Descarte do "a faturar" no /config (T-0093, critério 3; RN-CAD-10) no PostgreSQL real, contra `faturamento.portal_descartar_a_faturar`
 * da migração 0065 (papel macuxierp_config, sessão de superadmin) e a emissão real pela rota POST /notas. Nota, XML e evento fiscal
 * nunca são tocados. Sem Postgres o teste pula (PG_DISPONIVEL, `bash db/scripts/pg-local.sh`); com Postgres e sem a 0065 ele falha.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { comoConfig, criarBancoEfemero, criarTenant, PG_DISPONIVEL, semearSessaoSuperadmin, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroApi } from '@macuxierp/platform-sdk';
import { pedidoNovoNaFila, pluginSql, uuid } from './apoio-teste';
import { pedidosAprovadosSql, repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('descarte do a faturar (faturamento.portal_descartar_a_faturar, migração 0065)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let sessao: string;
  let A: string;
  const q = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const repos = repositoriosSql({ outbox: new OutboxPg(), agora: () => new Date('2026-11-25T14:30:00Z') });
  const status = async (pid: string): Promise<unknown> => (await q('SELECT status FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [pid]))[0]?.status;
  const contagens = async () => (await q('SELECT (SELECT count(*)::int FROM faturamento.nota) AS notas, (SELECT count(*)::int FROM faturamento.nota_xml) AS xmls, (SELECT count(*)::int FROM faturamento.nota_evento) AS eventos'))[0];

  /** Uma transação como macuxierp_config com a sessão de superadmin (o que o `comPlataforma` faz), pelo SDK. */
  const descartar = (ids: string[]): Promise<{ a_faturar_cancelados: number }> =>
    comoConfig(efemero.admin, sessao, async (consultar) => (await consultar('SELECT faturamento.portal_descartar_a_faturar($1::uuid, $2::uuid[]) AS r', [A, ids]))[0]!.r as { a_faturar_cancelados: number });
  const novoNaFila = () => app.comTenant(A, (tx) => pedidoNovoNaFila(tx, (t, p) => pedidosAprovadosSql.gravar(t, p)));

  /** A emissão real (rota POST /notas, fila e numeração do banco): devolve o erro da rota ou o resultado. */
  function emitir(pedido_id: string): Promise<unknown> {
    const rota = pluginSql(repos).rotas.find((r) => r.metodo === 'POST' && r.caminho === '/notas')!;
    return app.comTenant(A, (tx) => rota.executar({ tx, sessao: { usuario_id: uuid(5), tenant_id: A, perfil: 'faturista', filial_ids: [] }, enfileirar: async () => ({ id: 'x' }), auditar: async () => undefined } as never, { corpo: { pedido_id, idempotencia: `idem-desc-${pedido_id}` }, params: {}, cabecalhos: {}, arquivos: {}, todosArquivos: {} } as never)).catch((e: unknown) => e);
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    const temFuncao = (await q("SELECT to_regprocedure('faturamento.portal_descartar_a_faturar(uuid, uuid[])') IS NOT NULL AS ok"))[0]!.ok;
    expect(temFuncao, 'faturamento.portal_descartar_a_faturar (migração 0065) ausente no banco').toBe(true);
    A = await criarTenant(efemero.admin, 'fat-descarte', ['faturamento']);
    sessao = (await semearSessaoSuperadmin(efemero.admin)).sessao_id;
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-10: a linha descartada (cancelado) faz a emissão do pedido ser recusada com 422, sem reservar número nem criar nota', async () => {
    const pid = await novoNaFila();
    const antes = await contagens();
    expect(await descartar([pid])).toEqual({ a_faturar_cancelados: 1 });
    expect(await status(pid)).toBe('cancelado');
    const e = await emitir(pid);
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CAD-10' });
    expect(await q('SELECT count(*)::int AS n FROM faturamento.serie_numeracao')).toEqual([{ n: 0 }]);
    expect(await contagens()).toEqual(antes); // nota, XML e evento fiscal nunca são tocados
  });
});
