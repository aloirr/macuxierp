/**
 * Títulos a receber contra o PostgreSQL real (migração 0013: `titulo` e `titulo_baixa`): geração na autorização (mesma tx), rateio exato, cartão e à
 * vista sem título, baixa parcial e total, estorno, CHECK do saldo, RLS entre tenants e saldo por cliente só de produção (RN-PED-04).
 * O cancelamento com e sem baixa roda no `eventos.db.test.ts` (processador de eventos real). Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { a1DeTeste, depsFake, transporteFake, uuid } from './apoio-teste';
import { criarServicoEmissao } from './emissao';
import { pedidosAprovadosSql, repositoriosSql } from './sql';
import { configuracaoFake } from './apoio-teste';
import { consultaTitulosPedido, criarServicoTitulos, criarVarreduraTitulos } from './titulos';
import { criarTransmissor } from './transmissor';

describe.skipIf(!PG_DISPONIVEL)('títulos a receber (PostgreSQL real, migração 0013)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  let B: string;
  let C: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const repos = repositoriosSql({ outbox: new OutboxPg(), agora: () => new Date('2026-11-21T14:30:00Z') });
  const svc = criarServicoTitulos({ titulos: repos.titulos, notas: repos.notas }, () => new Date('2026-11-25T15:00:00Z'));
  const mk = (id: string, forma: string) => {
    const p = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)], { pedido_id: id });
    p.pedido.condicao_pagamento_id = uuid(77);
    p.pedido.forma_tpag = forma;
    return p;
  };
  const boleto = mk(IDS.pedido, '15');
  const cartao = mk(uuid(3001), '03');
  const aVista = mk(uuid(3002), '01');
  const f = depsFake({ ambiente: 'homologacao' });
  Object.assign(f.deps, { notas: repos.notas, pedidos: repos.pedidos, ambiente: repos.ambiente });
  const emissao = criarServicoEmissao(f.deps);
  const emissaoC = criarServicoEmissao({ ...f.deps, sorteio: () => 424242 }); // a chave de acesso é única no banco: outro cNF no tenant de produção
  let idem = 0;

  /** Emite e autoriza pelo transmissor com o repositório SQL de títulos (mesma tx do `nota.autorizada@1`). */
  async function autorizar(tenant: string, pedido_id: string) {
    const r = await app.comTenant(tenant, (tx) => (tenant === C ? emissaoC : emissao).emitirNota(tx, tenant, { pedido_id, idempotencia: `idem-titdb-${++idem}` }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const t = transporteFake();
    const tr = criarTransmissor({ banco: worker, notas: repos.notas, titulos: repos.titulos, emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => t.transporte, agora: () => new Date('2026-11-21T14:31:02Z') });
    expect((await tr.transmitirNota(tenant, r.nota.id)).resultado).toBe('autorizada');
    return (await app.comTenant(tenant, (tx) => repos.notas.obter(tx, r.nota.id)))!;
  }
  const titulosDe = (tenant: string, nota_id: string) => app.comTenant(tenant, (tx) => repos.titulos.listarDaNota(tx, nota_id));

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'fat-titulos-a', ['faturamento']);
    B = await criarTenant(efemero.admin, 'fat-titulos-b', ['faturamento']);
    C = await criarTenant(efemero.admin, 'fat-titulos-c', ['faturamento']);
    await admin("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', 'R-20261122-000000-alexandre')", [C, IDS.filial]);
    for (const t of [A, C]) for (const p of [boleto, cartao, aVista]) await app.comTenant(t, (tx) => pedidosAprovadosSql.gravar(tx, p));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RF-FAT-07 / RN-FAT-06: a autorização do boleto gera os títulos na mesma tx, com rateio exato, dados da nota, e titulo.gerado@1 com agregado = titulo.id', async () => {
    const nota = await autorizar(A, IDS.pedido);
    const ts = await titulosDe(A, nota.id);
    expect(ts).toHaveLength(2);
    expect(ts.reduce((a, t) => a + t.valor_centavos, 0)).toBe(nota.total_centavos);
    expect(ts.map((t) => [t.parcela, t.total_parcelas, t.status, t.saldo_centavos === t.valor_centavos])).toEqual([[1, 2, 'aberto', true], [2, 2, 'aberto', true]]);
    expect(ts.every((t) => t.numero === nota.numero && typeof t.cliente_razao_social === 'string' && t.cliente_razao_social.length > 0)).toBe(true); // numero e razão social do retrato da nota
    expect(ts.every((t) => t.ambiente === 'homologacao' && t.cliente_id === nota.cliente_id && t.filial_id === nota.filial_id)).toBe(true);
    expect(ts.map((t) => t.vencimento)).toEqual(['2026-12-21', '2027-01-20']);
    const ev = await admin("SELECT agregado_id, payload FROM plataforma.evento WHERE nome = 'faturamento.titulo.gerado@1' AND tenant_id = $1 AND (payload->'payload'->>'nota_id') = $2 ORDER BY (payload->'payload'->>'parcela')::int", [A, nota.id]);
    expect(ev.map((e) => e.agregado_id)).toEqual(ts.map((t) => t.id));
    expect(ev[0]?.payload.payload).toMatchObject({ titulo_id: ts[0]?.id, ambiente: 'homologacao', parcela: 1 });
    expect(ev[0]?.payload.payload.conta_como_real).toBeUndefined();
  });

  it('RN-FAT-06: cartão e à vista não geram título', async () => {
    for (const p of [cartao, aVista]) {
      const nota = await autorizar(A, p.pedido_id);
      expect(await titulosDe(A, nota.id)).toEqual([]);
    }
  });

  it('RN-FAT-06: baixa parcial, baixa total e estorno; o banco abate o saldo e reabre; baixa acima do saldo cai no CHECK titulo_saldo', async () => {
    const nota = await autorizar(A, IDS.pedido);
    const [t1] = await titulosDe(A, nota.id);
    const b1 = await app.comTenant(A, (tx) => svc.baixar(tx, t1!.id, { valor_centavos: 1000, forma: 'pix' }, uuid(5)));
    expect(b1.titulo).toMatchObject({ status: 'aberto', saldo_centavos: t1!.valor_centavos - 1000 });
    // o serviço recusa antes do banco; o INSERT direto cai no CHECK do saldo
    await expect(app.comTenant(A, (tx) => svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos, forma: 'pix' }, null))).rejects.toMatchObject({ codigo: 'RN-FAT-06' });
    await expect(app.comTenant(A, (tx) => repos.titulos.registrarBaixa(tx, t1!.id, { valor_centavos: t1!.valor_centavos, forma: 'pix', usuario_id: null, baixado_em: new Date() }))).rejects.toThrow(/titulo_saldo|saldo/);
    expect((await admin('SELECT saldo_centavos::float8 AS s FROM faturamento.titulo WHERE id = $1', [t1!.id]))[0]?.s).toBe(t1!.valor_centavos - 1000);
    const b2 = await app.comTenant(A, (tx) => svc.baixar(tx, t1!.id, { valor_centavos: t1!.valor_centavos - 1000, forma: 'pix' }, null));
    expect(b2.titulo).toMatchObject({ status: 'baixado', saldo_centavos: 0 });
    const baixados = await admin("SELECT payload FROM plataforma.evento WHERE nome = 'faturamento.titulo.baixado@1' AND agregado_id = $1 ORDER BY created_at", [t1!.id]);
    expect(baixados.map((e) => e.payload.payload.valor_baixado_centavos)).toEqual([1000, t1!.valor_centavos - 1000]);
    const e = await app.comTenant(A, (tx) => svc.estornar(tx, t1!.id, b2.baixa.id));
    expect(e.titulo).toMatchObject({ status: 'aberto', saldo_centavos: t1!.valor_centavos - 1000 });
    await expect(app.comTenant(A, (tx) => svc.estornar(tx, t1!.id, b2.baixa.id))).rejects.toMatchObject({ codigo: 'RN-FAT-06' });
    // o saldo não muda por fora das baixas
    await expect(admin('UPDATE faturamento.titulo SET saldo_centavos = 1 WHERE id = $1', [t1!.id])).rejects.toThrow(/RN-FAT-06/);
    const det = await app.comTenant(A, (tx) => repos.titulos.detalhar(tx, t1!.id));
    expect(det?.baixas.map((x) => [x.valor_centavos, x.estornada_em !== null])).toEqual([[1000, false], [t1!.valor_centavos - 1000, true]]);
  });

  it('RF-FAT-07: a listagem filtra por cliente, status e vencimento e pagina por cursor', async () => {
    const todos = await app.comTenant(A, (tx) => repos.titulos.listar(tx, { limite: 2, cliente_id: IDS.cliente, status: 'aberto', vencimento_ate: '2027-12-31' }));
    expect(todos.itens).toHaveLength(2);
    expect(todos.proximo_cursor).not.toBeNull();
    const prox = await app.comTenant(A, (tx) => repos.titulos.listar(tx, { limite: 50, cliente_id: IDS.cliente, cursor: todos.proximo_cursor! }));
    expect(prox.itens.every((t) => t.id > todos.itens[1]!.id)).toBe(true);
    expect((await app.comTenant(A, (tx) => repos.titulos.listar(tx, { limite: 50, vencimento_de: '2030-01-01' }))).itens).toEqual([]);
  });

  it('RN-CORE-01: o outro tenant não enxerga nem baixa título (RLS)', async () => {
    const nota = await autorizar(A, IDS.pedido);
    const [t1] = await titulosDe(A, nota.id);
    expect((await app.comTenant(B, (tx) => repos.titulos.listar(tx, { limite: 50 }))).itens).toEqual([]);
    expect(await app.comTenant(B, (tx) => repos.titulos.detalhar(tx, t1!.id))).toBeNull();
    await expect(app.comTenant(B, (tx) => svc.baixar(tx, t1!.id, { valor_centavos: 100, forma: 'pix' }, null))).rejects.toMatchObject({ status: 404 });
  });

  it('RN-PED-04: o saldo aberto por cliente só soma título de produção (homologação não conta) e a porta do pedido o devolve', async () => {
    const porta = consultaTitulosPedido(repos.titulos);
    expect(await app.comTenant(A, (tx) => porta.saldoAbertoCliente(tx, IDS.cliente))).toBe(0); // A só tem homologação, com títulos abertos
    expect((await admin("SELECT count(*)::int AS n FROM faturamento.titulo WHERE tenant_id = $1 AND status = 'aberto'", [A]))[0]?.n).toBeGreaterThan(0);
    const nota = await autorizar(C, IDS.pedido);
    expect(nota.ambiente).toBe('producao');
    const ts = await titulosDe(C, nota.id);
    expect(await app.comTenant(C, (tx) => porta.saldoAbertoCliente(tx, IDS.cliente))).toBe(nota.total_centavos);
    await app.comTenant(C, (tx) => svc.baixar(tx, ts[0]!.id, { valor_centavos: 1000, forma: 'pix' }, null));
    expect(await app.comTenant(C, (tx) => porta.saldoAbertoCliente(tx, IDS.cliente))).toBe(nota.total_centavos - 1000);
    expect(await app.comTenant(C, (tx) => porta.saldoAbertoCliente(tx, uuid(404)))).toBe(0);
    expect(await app.comTenant(B, (tx) => porta.saldoAbertoCliente(tx, IDS.cliente))).toBe(0);
  });
  it('RN-FAT-03: a geração falha na autorização (savepoint real): a nota fica autorizada com o nfeProc guardado, sem título; a varredura gera depois, uma vez só', async () => {
    const r = await app.comTenant(A, (tx) => emissao.emitirNota(tx, A, { pedido_id: IDS.pedido, idempotencia: `idem-titdb-${++idem}` }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const quebrado = { ...repos.titulos, inserirParcelas: async () => { throw new Error('falha de teste'); } };
    const logs: object[] = [];
    const tr = criarTransmissor({ banco: worker, notas: repos.notas, titulos: quebrado, log: (e) => logs.push(e), emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => transporteFake().transporte, agora: () => new Date('2026-11-21T14:31:02Z') });
    expect(await tr.transmitirNota(A, r.nota.id)).toMatchObject({ resultado: 'autorizada', titulos_pendentes: expect.any(String) });
    expect(logs).toEqual([expect.objectContaining({ evento: 'faturamento.titulo.geracao_pendente', nota_id: r.nota.id })]);
    expect((await admin("SELECT status FROM faturamento.nota WHERE id = $1", [r.nota.id]))[0]?.status).toBe('autorizada');
    expect((await admin("SELECT count(*)::int AS n FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_autorizada'", [r.nota.id]))[0]?.n).toBe(1);
    expect(await titulosDe(A, r.nota.id)).toEqual([]);
    const varrer = criarVarreduraTitulos({ titulos: repos.titulos, notas: repos.notas, log: () => undefined });
    const agoraBanco = { ha_minutos: 0, limite: 50 };
    const v = await app.comTenant(A, (tx) => varrer(tx, agoraBanco));
    expect(v.geradas).toBe(2);
    expect(await titulosDe(A, r.nota.id)).toHaveLength(2);
    expect((await app.comTenant(A, (tx) => varrer(tx, agoraBanco))).geradas).toBe(0);
  });

  it('RN-PED-04: título de nota conta_como_real (homologação com a bandeira ligada na emissão) entra no saldo aberto do cliente', async () => {
    await app.comTenant(B, (tx) => pedidosAprovadosSql.gravar(tx, boleto));
    const emissaoReal = criarServicoEmissao({ ...f.deps, sorteio: () => 777001, configuracao: configuracaoFake({ [IDS.filial]: true }).repo });
    const r = await app.comTenant(B, (tx) => emissaoReal.emitirNota(tx, B, { pedido_id: IDS.pedido, idempotencia: `idem-titdb-${++idem}` }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const tr = criarTransmissor({ banco: worker, notas: repos.notas, titulos: repos.titulos, emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => transporteFake().transporte, agora: () => new Date('2026-11-21T14:31:02Z') });
    expect((await tr.transmitirNota(B, r.nota.id)).resultado).toBe('autorizada');
    expect(await app.comTenant(B, (tx) => consultaTitulosPedido(repos.titulos).saldoAbertoCliente(tx, IDS.cliente))).toBe(r.nota.total_centavos);
  });
});
