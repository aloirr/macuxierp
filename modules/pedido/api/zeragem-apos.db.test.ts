/**
 * T-0093, critério 3 (RN-CAD-10, RN-PED-01) no PostgreSQL real, com as funções da migração 0065: o zerar de pedidos
 * (`pedido.portal_zerar`, 0064) mais a porta SQL `criarAposZerarPedidosSql` na MESMA transação, no papel macuxierp_config com a
 * sessão de superadmin. O seed de `integracao_fdv.pedido_recebido` e de `faturamento.pedido_a_faturar` é do admin (mesmo padrão
 * dos db tests do banco). Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { randomUUID } from 'node:crypto';
import type { Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMINHOS_ZERAR_PEDIDOS } from '../contracts';
import { criarAposZerarPedidosSql, type AposZerarPedidos } from './apos-zerar';
import { IDS, pedidoFdv, prepararCadastros } from './fixtures-teste';
import { dependenciasDeProducao } from './index';
import { CadastrosMemoria } from './memoria';
import { criarRecebedorFdv } from './recebedor';
import { criarPluginPlataformaPedidoZerar } from './zeragem';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const AGORA = new Date('2026-11-21T15:00:00Z'); // hora-fixa-ok: instante do relógio do recebedor; o now() do SQL só valida a sessão e nunca é comparado

describe.skipIf(!PG_DISPONIVEL)('porta aposZerarPedidos no banco (0065)', () => {
  let efemero: BancoEfemero;
  let worker: BancoPg;
  let sessao: string;
  const cad = new CadastrosMemoria();
  const q = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const n = async (sql: string, p: unknown[]) => (await q(`SELECT count(*)::int AS n FROM ${sql}`, p))[0]!.n as number;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    worker = efemero.banco('macuxierp_worker');
    for (const f of ['pedido.portal_zerar(uuid, jsonb, text)', 'integracao_fdv.portal_liberar_reenvio_pedidos(uuid, uuid[])', 'faturamento.portal_descartar_a_faturar(uuid, uuid[])']) {
      const ok = (await q('SELECT to_regprocedure($1) IS NOT NULL AS ok', [f]))[0]!.ok;
      expect(ok, `${f} ausente no banco`).toBe(true);
    }
    await q(`DO $$ BEGIN IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN GRANT macuxierp_config TO CURRENT_USER; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    sessao = randomUUID();
    const sa = randomUUID();
    await q(`INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'sa-pedido-apos@plataforma.teste', 'Superadmin Ficticio', $2, false, true)`, [sa, HASH]);
    await q(`INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em) -- hora-fixa-ok: now() só da sessão
      VALUES ($1, $2, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'), now() + interval '8 hours', now())`, [sessao, sa, sessao]);
    prepararCadastros(cad, { saldo: 1_000_000_000 });
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  /** Recebe o pedido do FDV pelo recebedor real e semeia o que o Hub e o faturamento teriam gravado. */
  async function pedidoDoFdv(slug: string) {
    const T = await criarTenant(efemero.admin, slug, ['pedido']);
    const recebedor = criarRecebedorFdv({ ...dependenciasDeProducao(cad), licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    const receber = () => worker.comTenant(T, (tx) => recebedor.receber(tx, pedidoFdv()));
    const r = await receber();
    expect(r).toMatchObject({ resultado: 'criado' });
    const id = (r as { pedido_id: string }).pedido_id;
    await q(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado, pedido_id) VALUES ($1, $2, NULL, repeat('1', 64), 'entregue', $3)`, [T, IDS.pedidoFdv, id]);
    await q(`INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash, estado) VALUES ($1, $2, 'integrado', 'PED-1', '{"status": "integrado"}', repeat('2', 64), 'pendente')`, [T, IDS.pedidoFdv]);
    await q(`INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload, status) VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), '{"itens": []}', 'a_faturar')`, [T, id]);
    return { T, id, receber };
  }

  /** Executa a rota de zerar do plugin numa transação como macuxierp_config; `commit` falso desfaz no fim. */
  async function zerar(T: string, apos: AposZerarPedidos, commit = true) {
    const c = await efemero.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE macuxierp_config');
      await c.query(`SET LOCAL macuxierp.sessao_superadmin = '${sessao}'`);
      const tx = { consultar: async (sql: string, p: readonly unknown[] = []) => (await c.query(sql, [...p])).rows } as unknown as Transacao;
      const plugin = criarPluginPlataformaPedidoZerar({ aposZerar: apos, faturamento: { pedidosComNotaOuTitulo: async () => ({ comNota: [], comTitulo: [] }) } });
      const rota = plugin.rotas.find((r) => r.caminho === CAMINHOS_ZERAR_PEDIDOS.zerar)!;
      const ctx = { sessao: { superadmin_id: 'a', sessao_id: sessao }, tx, request_id: 'req-db', agora: AGORA, auditar: async () => {} };
      const r = await rota.executar(ctx, { corpo: rota.corpo!.parse({ frase: 'autorizo zerar os dados' }), params: { id: T } } as never);
      await c.query(commit ? 'COMMIT' : 'ROLLBACK');
      return r.corpo as { apagados: { tabela: string; quantidade: number }[] };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  it('RN-CAD-10: zerar com a porta SQL descarta o a_faturar (cancelado) e devolve as contagens da 0065', async () => {
    const { T, id } = await pedidoDoFdv('apos-a-faturar');
    const r = await zerar(T, criarAposZerarPedidosSql());
    expect(r.apagados).toEqual(expect.arrayContaining([
      { tabela: 'pedido', quantidade: 1 },
      { tabela: 'integracao_fdv.pedido_recebido', quantidade: 1 },
      { tabela: 'integracao_fdv.retorno_enviado', quantidade: 1 },
      { tabela: 'faturamento.pedido_a_faturar', quantidade: 1 },
    ]));
    expect((await q('SELECT status FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [id]))).toEqual([{ status: 'cancelado' }]);
  });

  it('RN-PED-01 e RN-CAD-10: o pedido_recebido é liberado e o pedido do FDV volta quando o Hub reenvia o mesmo pedido_uuid', async () => {
    const { T, id, receber } = await pedidoDoFdv('apos-reenvio');
    await zerar(T, criarAposZerarPedidosSql());
    expect(await n('pedido.pedido WHERE tenant_id = $1', [T])).toBe(0);
    expect(await n('integracao_fdv.pedido_recebido WHERE tenant_id = $1', [T])).toBe(0);
    expect(await n('integracao_fdv.retorno_enviado WHERE tenant_id = $1', [T])).toBe(0);
    // O Hub grava de novo o mesmo pedido_uuid: o único (tenant_id, pedido_uuid) não bloqueia mais.
    await q(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado, pedido_id) VALUES ($1, $2, NULL, repeat('1', 64), 'entregue', gen_random_uuid())`, [T, IDS.pedidoFdv]);
    const volta = await receber();
    expect(volta).toMatchObject({ resultado: 'criado', status: 'aprovado' });
    expect((volta as { pedido_id: string }).pedido_id).not.toBe(id);
  });

  it('RN-CAD-10: se a porta falha, o zerar inteiro é desfeito (pedido, pedido_recebido e a_faturar ficam)', async () => {
    const { T, id } = await pedidoDoFdv('apos-falha');
    const sql = criarAposZerarPedidosSql();
    const falha: AposZerarPedidos = {
      async aposZerarPedidos(tx, t, ids) {
        await sql.aposZerarPedidos(tx, t, ids);
        throw new Error('falha depois da porta');
      },
    };
    await expect(zerar(T, falha)).rejects.toThrow('falha depois da porta');
    expect(await n('pedido.pedido WHERE tenant_id = $1', [T])).toBe(1);
    expect(await n('integracao_fdv.pedido_recebido WHERE tenant_id = $1', [T])).toBe(1);
    expect(await n('integracao_fdv.retorno_enviado WHERE tenant_id = $1', [T])).toBe(1);
    expect((await q('SELECT status FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [id]))).toEqual([{ status: 'a_faturar' }]);
  });

  it('RN-CAD-10: tenant nulo na porta SQL sobe P0002 (o erro não é tratado)', async () => {
    const c = await efemero.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE macuxierp_config');
      await c.query(`SET LOCAL macuxierp.sessao_superadmin = '${sessao}'`);
      const tx = { consultar: async (sql: string, p: readonly unknown[] = []) => (await c.query(sql, [...p])).rows } as unknown as Transacao;
      await expect(criarAposZerarPedidosSql().aposZerarPedidos(tx, null as unknown as string, [randomUUID()])).rejects.toMatchObject({ code: 'P0002' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
