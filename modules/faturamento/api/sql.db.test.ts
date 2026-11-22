/**
 * Adaptador SQL do faturamento contra o PostgreSQL real, com a migração 0013 (papéis macuxierp_app e macuxierp_worker, RLS por tenant,
 * gatilhos de numeração, de XML imutável e de status). Banco efêmero de `@macuxierp/platform-sdk/pg-testes`; sem Postgres o teste
 * pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { criarServicoEmissao } from './emissao';
import { a1DeTeste, depsFake, protocolo, transporteFake, pedidoNovoNaFila, uuid, type Roteiro } from './apoio-teste';
import { repositoriosSql, pedidosAprovadosSql, notaEmAbertoSql } from './sql';
import { criarTransmissor } from './transmissor';

describe.skipIf(!PG_DISPONIVEL)('adaptador SQL do faturamento (PostgreSQL real, migração 0013)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  let B: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const repos = repositoriosSql({ outbox: new OutboxPg(), agora: () => new Date('2026-11-21T14:30:00Z') });
  const pedido = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
  pedido.pedido.condicao_pagamento_id = uuid(77);

  function servico() {
    const f = depsFake({ ambiente: 'homologacao' });
    f.deps.notas = repos.notas;
    f.deps.pedidos = repos.pedidos;
    f.deps.ambiente = repos.ambiente;
    return { ...f, svc: criarServicoEmissao(f.deps) };
  }
  /** Um pedido novo por chave de idempotência (a repetição da chave reaproveita o mesmo pedido); várias notas totais não passam do saldo de um pedido só. */
  const pedidoDaChave = new Map<string, string>();
  const emitir = (tenant: string, idem: string, s = servico()) =>
    app.comTenant(tenant, async (tx) => {
      if (!pedidoDaChave.has(idem)) pedidoDaChave.set(idem, await pedidoNovoNaFila(tx, pedidosAprovadosSql.gravar));
      return s.svc.emitirNota(tx, tenant, { pedido_id: pedidoDaChave.get(idem)!, idempotencia: idem });
    });

  function transmissor(s: ReturnType<typeof servico>, roteiro: Roteiro = {}) {
    const t = transporteFake(roteiro);
    return {
      t,
      tr: criarTransmissor({
        log: () => undefined,
        banco: worker,
        notas: repos.notas, titulos: repos.titulos,
        emissor: s.emissor,
        ambiente: repos.ambiente,
        lerA1: async () => a1DeTeste(),
        sefaz: () => t.transporte,
        agora: () => new Date('2026-11-21T14:30:00Z'),
      }),
    };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'fat-a', ['faturamento']);
    B = await criarTenant(efemero.admin, 'fat-b', ['faturamento']);
    await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, pedido));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RF-FAT-01: o pedido aprovado entra na fila a faturar uma vez só e o outro tenant não o enxerga (RLS)', async () => {
    expect(await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, pedido))).toBe('repetido');
    expect((await app.comTenant(A, (tx) => pedidosAprovadosSql.obter(tx, IDS.pedido)))?.pedido_id).toBe(IDS.pedido);
    expect(await app.comTenant(B, (tx) => pedidosAprovadosSql.obter(tx, IDS.pedido))).toBeNull();
    expect(await admin('SELECT count(*)::int AS n FROM faturamento.pedido_a_faturar')).toEqual([{ n: 1 }]);
  });

  it('RF-FAT-01: reentrega de aprovado antigo: grava com o status da situação atual, só atualiza quando o status muda e marcarCancelado não cria linha', async () => {
    const id = await app.comTenant(A, (tx) => pedidoNovoNaFila(tx, (t, p) => pedidosAprovadosSql.gravar(t, p, 'faturado')));
    const status = async (): Promise<unknown> => (await admin('SELECT status FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [id]))[0]?.status;
    expect(await status()).toBe('faturado');
    const p = await app.comTenant(A, (tx) => pedidosAprovadosSql.obter(tx, id));
    expect(await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, p!, 'faturado'))).toBe('repetido');
    expect(await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, p!, 'faturado_parcial'))).toBe('repetido');
    expect(await status()).toBe('faturado_parcial');
    await app.comTenant(A, (tx) => pedidosAprovadosSql.marcarCancelado(tx, id));
    expect(await status()).toBe('cancelado');
    await app.comTenant(A, (tx) => pedidosAprovadosSql.marcarCancelado(tx, uuid(999)));
    expect(await admin('SELECT count(*)::int AS n FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [uuid(999)])).toEqual([{ n: 0 }]);
  });

  it('RN-FAT-01: emite sem buraco (100, 101), é idempotente pela chave, grava o conteúdo e o ambiente vem do banco', async () => {
    const r1 = await emitir(A, 'idem-db-0001');
    if (!r1.ok) throw new Error(JSON.stringify(r1.violacoes));
    expect(r1.nota).toMatchObject({ numero: 100, serie: 1, status: 'rascunho', ambiente: 'homologacao', total_centavos: 4500, vai_ao_fdv: false });
    const rep = await emitir(A, 'idem-db-0001');
    expect(rep.ok && rep.repetida && rep.nota.id).toBe(r1.nota.id);
    const r2 = await emitir(A, 'idem-db-0002');
    expect(r2.ok && r2.nota.numero).toBe(101);
    expect(await admin('SELECT count(*)::int AS n FROM faturamento.nota_item WHERE nota_id = $1', [r1.nota.id])).toEqual([{ n: 2 }]);
    expect((await admin('SELECT numero_inicial, proximo FROM faturamento.serie_numeracao'))[0]).toMatchObject({ numero_inicial: 100, proximo: 102 });
    expect(await app.comTenant(A, (tx) => tx.consultar('SELECT * FROM faturamento.buracos_numeracao()'))).toEqual([]);
    expect(await app.comTenant(B, (tx) => repos.notas.obter(tx, r1.nota.id))).toBeNull();
    expect((await app.comTenant(A, (tx) => repos.notas.listar(tx, { limite: 50 }))).itens).toHaveLength(2);
    const cont = await app.comTenant(A, (tx) => repos.notas.lerConteudo(tx, r1.nota.id));
    expect(cont?.itens.map((i) => [i.sequencia, i.quantidade, i.origem, i.calculo.cfop])).toEqual([[1, 20_000, '0', '5102'], [2, 10_000, '0', '5102']]);
    expect(cont?.cobranca?.parcelas).toHaveLength(2);
  });

  it('RN-FAT-03: o worker transmite, guarda o nfeProc (gatilho leva a autorizada), publica nota.autorizada@1 e a nota autorizada nunca é editada', async () => {
    const s = servico();
    const r = await emitir(A, 'idem-db-0003', s);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const { tr, t } = transmissor(s);
    expect((await tr.transmitirNota(A, r.nota.id)).resultado).toBe('autorizada');
    expect(t.chamadas).toEqual(['autorizar', 'consultarRecibo']);
    const [n] = await admin('SELECT status, protocolo, c_stat, recibo, autorizada_em FROM faturamento.nota WHERE id = $1', [r.nota.id]);
    expect(n).toMatchObject({ status: 'autorizada', protocolo: '113260000000001', c_stat: 100, recibo: '131000000000001' });
    expect(n?.autorizada_em).toBeInstanceOf(Date);
    const [x] = await admin("SELECT tipo, protocolo, xml, sha256 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_autorizada'", [r.nota.id]);
    expect(x).toMatchObject({ tipo: 'nfe_autorizada', protocolo: '113260000000001' });
    expect(x?.xml).toMatch(/^<nfeProc /);
    expect((await admin("SELECT nome FROM plataforma.evento WHERE agregado_id = $1", [r.nota.id])).map((e) => e.nome)).toEqual(['faturamento.nota.autorizada@1']);
    expect((await admin('SELECT servico, destino FROM faturamento.transmissao WHERE nota_id = $1 ORDER BY enviada_em, servico', [r.nota.id])).length).toBe(2);
    await expect(app.comTenant(A, (tx) => tx.consultar("UPDATE faturamento.nota SET total_nota_centavos = 1 WHERE id = $1", [r.nota.id]))).rejects.toThrow(/RN-FAT-02/);
    await expect(admin("UPDATE faturamento.nota_xml SET xml = 'x' WHERE nota_id = $1", [r.nota.id])).rejects.toThrow(/imutável/);
    expect((await app.comTenant(A, (tx) => repos.notas.lerXmlAutorizado(tx, r.nota.id)))?.xml).toMatch(/^<nfeProc /);
    expect(await app.comTenant(B, (tx) => repos.notas.lerXmlAutorizado(tx, r.nota.id))).toBeNull();
  });

  it('RN-FAT-07: rejeitada (778) publica nota.rejeitada@1, aparece no painel e o reenvio (API) mantém o número e o status rejeitada; o worker reassina e volta a em_autorizacao', async () => {
    const s = servico();
    const r = await emitir(A, 'idem-db-0004', s);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const { tr } = transmissor(s, { recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
    expect((await tr.transmitirNota(A, r.nota.id)).resultado).toBe('rejeitada');
    const painel = await app.comTenant(A, (tx) => repos.notas.listarRejeicoes(tx, { limite: 50 }));
    expect(painel.itens.find((i) => i.id === r.nota.id)).toMatchObject({ codigo: '778', numero: r.nota.numero });
    const re = await app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, r.nota.id, { travar: true }))!));
    expect(re.ok && re.nota).toMatchObject({ numero: r.nota.numero, chave_acesso: r.nota.chave_acesso, status: 'rejeitada', revisao: 2 });
    const [n] = await admin('SELECT status, recibo FROM faturamento.nota WHERE id = $1', [r.nota.id]);
    expect(n).toMatchObject({ status: 'rejeitada', recibo: null });
    const { tr: tr2 } = transmissor(s); // o worker reassina (v2) e volta a em_autorizacao; a SEFAZ do roteiro padrão autoriza
    expect((await tr2.transmitirNota(A, r.nota.id)).resultado).toBe('autorizada');
    expect((await admin("SELECT versao FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada' ORDER BY versao", [r.nota.id])).map((l) => l.versao)).toEqual([1, 2]);
    expect(await app.comTenant(A, (tx) => tx.consultar('SELECT * FROM faturamento.buracos_numeracao()'))).toEqual([]);
  });

  it('RN-FAT-04: o ambiente da nota é o da filial; com a filial em produção depois, o worker recusa o envio (RN-FAT-04)', async () => {
    const s = servico();
    const r = await emitir(A, 'idem-db-0005', s);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    await admin("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', 'R-20261122-000000-alexandre')", [A, IDS.filial]);
    const { tr, t } = transmissor(s);
    expect((await tr.transmitirNota(A, r.nota.id)).resultado).toBe('ambiente_mudou');
    expect(t.chamadas).toEqual([]);
    await admin('DELETE FROM core.ambiente_fiscal WHERE tenant_id = $1', [A]);
  });

  it('RN-CORE-05: duas emissões simultâneas com a mesma chave geram uma nota e um número só', async () => {
    const [a, b] = await Promise.all([emitir(A, 'idem-db-corrida'), emitir(A, 'idem-db-corrida')]);
    expect(a.ok && b.ok && a.nota.id === b.nota.id).toBe(true);
    expect(await admin("SELECT count(*)::int AS n FROM faturamento.nota WHERE idempotencia_chave = 'idem-db-corrida'")).toEqual([{ n: 1 }]);
    expect(await app.comTenant(A, (tx) => tx.consultar('SELECT * FROM faturamento.buracos_numeracao()'))).toEqual([]);
  });

  describe('corridas com o pedido (T-0021 lote 5)', () => {
    const pedidoCorrida = (n: number) => {
      const p = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
      p.pedido_id = uuid(900 + n);
      p.pedido.condicao_pagamento_id = uuid(77);
      return p;
    };
    function emitirDe(pid: string, idem: string, itens?: { sequencia: number; quantidade?: number }[]) {
      const s = servico();
      s.deps.pedidos = { ...repos.pedidos, obter: (tx, id) => repos.pedidos.obter(tx, id) }; // fila real
      return app.comTenant(A, (tx) => s.svc.emitirNota(tx, A, { pedido_id: pid, idempotencia: idem, itens }));
    }

    it('RN-FAT-01/RF-FAT-01: duas emissões simultâneas do pedido inteiro, com o pedido sem consumir evento, geram uma nota só; a outra é recusada pelo saldo', async () => {
      const p = pedidoCorrida(1);
      await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, p));
      const [a, b] = await Promise.all([emitirDe(p.pedido_id, 'idem-db-saldo-1'), emitirDe(p.pedido_id, 'idem-db-saldo-2')]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const recusada = a.ok ? b : a;
      expect(!recusada.ok && recusada.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01' });
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id))).toEqual(new Map([[1, 20_000], [2, 10_000]]));
      expect(await app.comTenant(A, (tx) => tx.consultar('SELECT * FROM faturamento.buracos_numeracao()'))).toEqual([]);
    });

    it('RN-PED-02 (P-2): nota rascunho, autorizada ou rejeitada bloqueia o cancelamento do pedido; cancelada e denegada não; quantidadesJaFaturadas ignora cancelada e a própria nota', async () => {
      const p = pedidoCorrida(2);
      await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, p));
      expect(await app.comTenant(A, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, p.pedido_id))).toBe(false);
      const r = await emitirDe(p.pedido_id, 'idem-db-aberta-1', [{ sequencia: 1, quantidade: 5_000 }]);
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      const id = r.nota.id;
      const aberta = (): Promise<boolean> => app.comTenant(A, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, p.pedido_id));
      expect(await aberta()).toBe(true); // rascunho numerada
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id, id))).toEqual(new Map());
      const s = servico();
      s.deps.pedidos = repos.pedidos;
      const { tr } = transmissor(s, { recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
      expect((await tr.transmitirNota(A, id)).resultado).toBe('rejeitada');
      expect(await aberta()).toBe(true); // rejeitada pode ser reenviada
      const re = await app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, id, { travar: true }))!));
      expect(re.ok).toBe(true);
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id))).toEqual(new Map([[1, 5_000]])); // o reenvio não conta a si mesmo em dobro
      const { tr: tr2 } = transmissor(s);
      expect((await tr2.transmitirNota(A, id)).resultado).toBe('autorizada');
      expect(await aberta()).toBe(true); // autorizada: o pedido só cancela depois de cancelar a nota
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id))).toEqual(new Map([[1, 5_000]]));
    });
  });
});
