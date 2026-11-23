/**
 * Adaptador SQL do faturamento contra o PostgreSQL real, com a migração 0013 (papéis macuxierp_app e macuxierp_worker, RLS por tenant,
 * gatilhos de numeração, de XML imutável e de status). Banco efêmero de `@macuxierp/platform-sdk/pg-testes`; sem Postgres o teste
 * pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { createHash } from 'node:crypto';
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { criarServicoEmissao } from './emissao';
import { a1DeTeste, depsFake, protocolo, transporteFake, pedidoNovoNaFila, uuid, type Roteiro, situacaoAprovadaDeTeste } from './apoio-teste';
import { repositoriosSql, pedidosAprovadosSql, notaEmAbertoSql } from './sql';
import { configuracaoFaturamentoSql } from './sql-configuracao';
import { criarPluginFaturamento } from './index';
import { criarTransmissor } from './transmissor';

const MANAUS = 'America/Manaus';
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
        situacao: situacaoAprovadaDeTeste, lerA1: async () => a1DeTeste(),
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
    const fila = await app.comTenant(A, (tx) => pedidosAprovadosSql.listar(tx, { limite: 50 }, MANAUS));
    expect(fila.itens).toHaveLength(1);
    // RN-FAT-04: cada linha traz o ambiente da filial emissora (sem configuração em core.ambiente_fiscal = homologação, a falha segura).
    expect(fila.itens[0]).toMatchObject({ status: 'a_faturar', total_centavos: expect.any(Number), ambiente: 'homologacao' });
    expect((await app.comTenant(B, (tx) => pedidosAprovadosSql.listar(tx, { limite: 50 }, MANAUS))).itens).toHaveLength(0);
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
    expect((await app.comTenant(A, (tx) => repos.notas.listar(tx, { limite: 50 }, MANAUS))).itens).toHaveLength(2);
    const cont = await app.comTenant(A, (tx) => repos.notas.lerConteudo(tx, r1.nota.id));
    expect(cont?.itens.map((i) => [i.sequencia, i.quantidade, i.origem, i.calculo.cfop])).toEqual([[1, 20_000, '0', '5102'], [2, 10_000, '0', '5102']]);
    expect(cont?.cobranca?.parcelas).toHaveLength(2);
  });

  it('RN-FAT-05/08: com a SVC-RS aberta da filial, a nota nasce com tipo_emissao 7, contingencia_em e a justificativa gravados (a constraint 0013 exige os três), na mesma sequência; encerrada, a nota volta ao normal e o conteúdo lido traz dhCont e xJust', async () => {
    const MOTIVO = 'SEFAZ-AM fora do ar desde as 9h';
    const INICIO = new Date('2026-11-21T09:00:00Z');
    const f = depsFake({ ambiente: 'homologacao' });
    f.deps.notas = repos.notas;
    f.deps.pedidos = repos.pedidos;
    f.deps.ambiente = repos.ambiente;
    f.deps.contingencia = repos.contingencia;
    const svc = criarServicoEmissao(f.deps);
    const emitirCom = (idem: string) =>
      app.comTenant(A, async (tx) => {
        const pid = await pedidoNovoNaFila(tx, pedidosAprovadosSql.gravar);
        return svc.emitirNota(tx, A, { pedido_id: pid, idempotencia: idem });
      });
    await app.comTenant(A, (tx) => repos.contingencia.abrir(tx, { filial_id: IDS.filial, ambiente: 'homologacao', modalidade: 'svc_rs', motivo: MOTIVO, inicio_em: INICIO, ligada_por: uuid(5) }));
    const r = await emitirCom('idem-db-svc-1');
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(r.nota.tp_emis).toBe(7);
    expect(r.nota.chave_acesso.slice(34, 35)).toBe('7');
    const [linha] = await admin("SELECT tipo_emissao, contingencia_em, contingencia_justificativa FROM faturamento.nota WHERE id = $1", [r.nota.id]);
    expect(linha).toMatchObject({ tipo_emissao: 7, contingencia_justificativa: MOTIVO });
    expect(new Date(linha!.contingencia_em as string).toISOString()).toBe(INICIO.toISOString());
    const cont = await app.comTenant(A, (tx) => repos.notas.lerConteudo(tx, r.nota.id));
    expect(cont?.contingencia).toEqual({ tpEmis: 7, dhCont: '2026-11-21T09:00:00.000Z', xJust: MOTIVO });
    await app.comTenant(A, (tx) => repos.contingencia.encerrar(tx, IDS.filial, 'homologacao', new Date('2026-11-21T10:00:00Z'), uuid(5)));
    const normal = await emitirCom('idem-db-svc-2');
    if (!normal.ok) throw new Error(JSON.stringify(normal.violacoes));
    expect(normal.nota).toMatchObject({ tp_emis: 1, numero: r.nota.numero + 1 });
    expect((await app.comTenant(A, (tx) => repos.notas.lerConteudo(tx, normal.nota.id)))?.contingencia).toBeUndefined();
  });

  it('RN-FAT-05/08/09: com a EPEC aberta a nota nasce tipo_emissao 4; o retorno 136 grava status, epec_protocolo e epec_autorizada_em num UPDATE só (gatilho B da 0032); a EPEC conta no saldo do pedido e some dele se a nota for cancelada; o EPEC gravado não muda', async () => {
    const MOTIVO = 'SEFAZ-AM fora do ar desde as 9h';
    const f = depsFake({ ambiente: 'homologacao' });
    f.deps.notas = repos.notas;
    f.deps.pedidos = repos.pedidos;
    f.deps.ambiente = repos.ambiente;
    f.deps.contingencia = repos.contingencia;
    const svc = criarServicoEmissao(f.deps);
    await app.comTenant(A, (tx) => repos.contingencia.abrir(tx, { filial_id: IDS.filial, ambiente: 'homologacao', modalidade: 'epec', motivo: MOTIVO, inicio_em: new Date('2026-11-21T09:00:00Z'), ligada_por: uuid(5) }));
    const r = await app.comTenant(A, async (tx) => svc.emitirNota(tx, A, { pedido_id: await pedidoNovoNaFila(tx, pedidosAprovadosSql.gravar), idempotencia: 'idem-db-epec-1' }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(r.nota.tp_emis).toBe(4);
    const xml = `<NFe><infNFe Id="NFe${r.nota.chave_acesso}"/></NFe>`;
    await app.comTenant(A, async (tx) => {
      await repos.notas.gravarXmlAssinado(tx, r.nota.id, xml, createHash('sha256').update(xml, 'utf8').digest('hex'));
      await repos.notas.mudarStatus(tx, r.nota.id, 'rascunho', 'em_autorizacao');
    });
    const epec = { protocolo: '913260000000777', autorizadaEm: '2026-11-21T14:30:01.000Z' };
    await app.comTenant(A, (tx) => repos.notas.mudarStatus(tx, r.nota.id, 'em_autorizacao', 'emitida_contingencia', { cStat: '136', xMotivo: 'Evento registrado e vinculado a NF-e', epec }));
    const lida = await app.comTenant(A, (tx) => repos.notas.obter(tx, r.nota.id));
    expect(lida).toMatchObject({ status: 'emitida_contingencia', tp_emis: 4, protocolo: null, epec_protocolo: epec.protocolo, epec_autorizada_em: epec.autorizadaEm });
    // RN-FAT-08: o EPEC gravado não muda (42501)
    await expect(app.comTenant(A, (tx) => tx.consultar(`UPDATE faturamento.nota SET epec_protocolo = '913260000000778' WHERE id = $1`, [r.nota.id]))).rejects.toMatchObject({ code: '42501' });
    // RN-FAT-08: a EPEC registrada conta no saldo do pedido (não deixa faturar de novo o que já tem evento)
    expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, r.nota.pedido_id))).toEqual(new Map([[1, 20_000], [2, 10_000]]));
    expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, r.nota.pedido_id, r.nota.id))).toEqual(new Map());
    await app.comTenant(A, (tx) => repos.contingencia.encerrar(tx, IDS.filial, 'homologacao', new Date('2026-11-21T15:00:00Z'), uuid(5)));
  });

  it('RD-0772: o filtro de/até das notas e dos pedidos a faturar respeita o fuso pedido (Manaus UTC-4 x Sao_Paulo UTC-3)', async () => {
    const r = await emitir(A, 'idem-db-fuso-1');
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    // 03:30Z de 21/11 = 20/11 23:30 em Manaus (UTC-4) e 21/11 00:30 em Sao_Paulo (UTC-3)
    await admin("UPDATE faturamento.nota SET emitida_em = '2026-11-21T03:30:00Z' WHERE id = $1", [r.nota.id]);
    await admin("UPDATE faturamento.pedido_a_faturar SET recebido_em = '2026-11-21T03:30:00Z' WHERE pedido_id = $1", [r.nota.pedido_id]);
    const n = (dia: string, fuso = MANAUS) => app.comTenant(A, async (tx) => (await repos.notas.listar(tx, { limite: 50, de: dia, ate: dia, pedido_id: r.nota.pedido_id! }, fuso)).itens.length);
    const p = (dia: string, fuso = MANAUS) => app.comTenant(A, async (tx) => (await pedidosAprovadosSql.listar(tx, { limite: 50, de: dia, ate: dia }, fuso)).itens.length);
    expect([await n('2026-11-20'), await n('2026-11-21')]).toEqual([1, 0]); // padrão = Manaus: dia 20
    expect([await n('2026-11-20', 'America/Sao_Paulo'), await n('2026-11-21', 'America/Sao_Paulo')]).toEqual([0, 1]);
    expect([await p('2026-11-20'), await p('2026-11-21')]).toEqual([1, 0]);
    expect([await p('2026-11-20', 'America/Sao_Paulo'), await p('2026-11-21', 'America/Sao_Paulo')]).toEqual([0, 1]);
  });

  it('RF-FAT-01: GET detalhe do pedido a faturar traz os itens com quantidade faturada pelo faturamento e saldo; outro tenant e id inexistente dão null (RLS)', async () => {
    const r = await emitir(A, 'idem-db-0001');
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const [fila] = await admin('SELECT id FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [r.nota.pedido_id]);
    const semSituacao = async () => null;
    const d = await app.comTenant(A, (tx) => pedidosAprovadosSql.detalhar(tx, fila!.id, semSituacao));
    expect(d).toMatchObject({ id: fila!.id, pedido_id: r.nota.pedido_id, ambiente: 'homologacao', status: 'a_faturar', numero: pedido.numero });
    expect(d?.itens).toEqual([
      { sequencia: 1, produto_id: expect.any(String), descricao: expect.any(String), quantidade_pedida: 20_000, quantidade_faturada: 20_000, saldo: 0, valor_unitario_centavos: 1000 },
      { sequencia: 2, produto_id: expect.any(String), descricao: expect.any(String), quantidade_pedida: 10_000, quantidade_faturada: 10_000, saldo: 0, valor_unitario_centavos: 2500 },
    ]);
    // nota cancelada devolve o saldo (RN-FAT-01): não conta como faturada
    let livre;
    await admin("ALTER TABLE faturamento.nota DISABLE TRIGGER USER");
    try {
      await admin("UPDATE faturamento.nota SET status = 'cancelada', cancelada_em = $2::timestamptz, protocolo = '113260000000099', autorizada_em = $2::timestamptz WHERE id = $1", [r.nota.id, '2026-11-21T14:30:00Z']);
      livre = await app.comTenant(A, (tx) => pedidosAprovadosSql.detalhar(tx, fila!.id, semSituacao));
      // vale o maior: o pedido já consumiu a 1ª unidade do item 1 (evento consumido), mesmo sem nota ativa
      const consumido = await app.comTenant(A, (tx) => pedidosAprovadosSql.detalhar(tx, fila!.id, async () => ({ status: 'faturado_parcial', itens: [{ sequencia: 1, quantidade: 20_000, quantidade_faturada: 10_000 }, { sequencia: 2, quantidade: 10_000, quantidade_faturada: 0 }] })));
      expect(consumido?.itens.map((i) => [i.quantidade_faturada, i.saldo])).toEqual([[10_000, 10_000], [0, 10_000]]);
    } finally {
      await admin("UPDATE faturamento.nota SET status = 'rascunho', cancelada_em = NULL, protocolo = NULL, autorizada_em = NULL WHERE id = $1", [r.nota.id]);
      await admin("ALTER TABLE faturamento.nota ENABLE TRIGGER USER");
    }
    expect(livre?.itens.map((i) => [i.quantidade_faturada, i.saldo])).toEqual([[0, 20_000], [0, 10_000]]);
    expect(await app.comTenant(B, (tx) => pedidosAprovadosSql.detalhar(tx, fila!.id, semSituacao))).toBeNull();
    expect(await app.comTenant(A, (tx) => pedidosAprovadosSql.detalhar(tx, uuid(998), semSituacao))).toBeNull();
  });

  it('RF-FAT-08: a lista de notas traz pedido_numero (retrato da fila) e filial_nome (emitente_retrato da própria nota, sem ler o cadastros)', async () => {
    const r = await emitir(A, 'idem-db-0001');
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const lista = await app.comTenant(A, (tx) => repos.notas.listar(tx, { limite: 50, pedido_id: r.nota.pedido_id! }, MANAUS));
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({ pedido_numero: pedido.numero, filial_nome: 'EMITENTE LTDA' }); // sem fantasia, vale a razão social
    // o detalhe da nota traz os mesmos dois campos, pela mesma projeção
    expect(await app.comTenant(A, (tx) => repos.notas.detalhar(tx, r.nota.id))).toMatchObject({ pedido_numero: pedido.numero, filial_nome: 'EMITENTE LTDA' });
    let com;
    let detCom;
    await admin("ALTER TABLE faturamento.nota DISABLE TRIGGER USER");
    try {
      await admin("UPDATE faturamento.nota SET emitente_retrato = emitente_retrato || jsonb_build_object('fantasia', 'Matriz Manaus') WHERE id = $1", [r.nota.id]);
      com = await app.comTenant(A, (tx) => repos.notas.listar(tx, { limite: 50, pedido_id: r.nota.pedido_id! }, MANAUS));
      detCom = await app.comTenant(A, (tx) => repos.notas.detalhar(tx, r.nota.id));
    } finally {
      await admin("ALTER TABLE faturamento.nota ENABLE TRIGGER USER");
    }
    expect(com.itens[0]?.filial_nome).toBe('Matriz Manaus');
    expect(detCom?.filial_nome).toBe('Matriz Manaus');
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
    // A tela decide o botão "Cancelar" por esta data: o detalhe tem de trazê-la (sem ela o cancelamento ficaria bloqueado para sempre).
    const det = await app.comTenant(A, (tx) => repos.notas.detalhar(tx, r.nota.id));
    expect(det?.autorizada_em).toBe((n?.autorizada_em as Date).toISOString());
    // RN-FAT-02: cancelamento aguardando a SEFAZ (evento pendente) aparece no detalhe; rejeitado ou registrado não conta.
    expect(det?.cancelamento_pendente).toBe(false);
    await admin("INSERT INTO faturamento.nota_evento (tenant_id, nota_id, tipo, n_seq_evento, texto) VALUES ($1, $2, 'cancelamento', 1, 'Cancelamento por erro de digitacao no pedido')", [A, r.nota.id]);
    expect((await app.comTenant(A, (tx) => repos.notas.detalhar(tx, r.nota.id)))?.cancelamento_pendente).toBe(true);
    await admin("UPDATE faturamento.nota_evento SET status = 'rejeitado', c_stat = 573, x_motivo = 'Rejeicao' WHERE nota_id = $1", [r.nota.id]);
    expect((await app.comTenant(A, (tx) => repos.notas.detalhar(tx, r.nota.id)))?.cancelamento_pendente).toBe(false);
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
    expect(painel.itens.find((i) => i.id === r.nota.id)).toMatchObject({ codigo: '778', numero: r.nota.numero, ambiente: 'homologacao' });
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
    // A fila a faturar mostra o mesmo ambiente que a emissão usa (a lista nunca promete homologação para filial em produção).
    expect((await app.comTenant(A, (tx) => pedidosAprovadosSql.listar(tx, { limite: 50 }, MANAUS))).itens.filter((i) => i.filial_id === IDS.filial).map((i) => i.ambiente)).toEqual(expect.arrayContaining(['producao']));
    const { tr, t } = transmissor(s);
    expect((await tr.transmitirNota(A, r.nota.id)).resultado).toBe('ambiente_mudou');
    expect(t.chamadas).toEqual([]);
    await admin('DELETE FROM core.ambiente_fiscal WHERE tenant_id = $1', [A]);
  });

  it('RN-FAT-04: GET /filiais/:id/configuracao devolve o ambiente da filial: sem configuração, homologação; com produção aprovada, produção', async () => {
    const plugin = criarPluginFaturamento({ ...servico().deps, notas: repos.notas, pedidos: repos.pedidos, ambiente: repos.ambiente, titulos: repos.titulos, configuracao: configuracaoFaturamentoSql } as never);
    const rota = plugin.rotas.find((r) => r.metodo === 'GET' && r.caminho === '/filiais/:id/configuracao')!;
    const ler = (perfil: string) => app.comTenant(A, (tx) => rota.executar({ tx, sessao: { usuario_id: uuid(5), tenant_id: A, perfil, filial_ids: [] } } as never, { params: { id: IDS.filial }, cabecalhos: {}, arquivos: {}, todosArquivos: {} } as never));
    expect((await ler('faturista')).corpo).toEqual({ filial_id: IDS.filial, faturamento_real_nfe_simulada: false, ambiente: 'homologacao' });
    await admin("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', 'R-20261122-000000-alexandre')", [A, IDS.filial]);
    expect((await ler('faturista')).corpo).toMatchObject({ ambiente: 'producao' });
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

    it('RN-PED-02 (P-2): só nota rascunho/em_autorizacao bloqueia o cancelamento do pedido (rejeitada e autorizada não; a autorizada vem de notasAutorizadas); quantidadesJaFaturadas ignora cancelada e a própria nota', async () => {
      const p = pedidoCorrida(2);
      await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, p));
      expect(await app.comTenant(A, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, p.pedido_id))).toBe(false);
      const r = await emitirDe(p.pedido_id, 'idem-db-aberta-1', [{ sequencia: 1, quantidade: 5_000 }]);
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      const id = r.nota.id;
      const aberta = (): Promise<boolean> => app.comTenant(A, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, p.pedido_id));
      const autorizadas = (): Promise<string[]> => app.comTenant(A, (tx) => notaEmAbertoSql.notasAutorizadas(tx, p.pedido_id));
      expect(await aberta()).toBe(true); // rascunho numerada
      expect(await autorizadas()).toEqual([]);
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id, id))).toEqual(new Map());
      const s = servico();
      s.deps.pedidos = repos.pedidos;
      const { tr } = transmissor(s, { recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
      expect((await tr.transmitirNota(A, id)).resultado).toBe('rejeitada');
      expect(await aberta()).toBe(false); // rejeitada fica fora (opção A do Alexandre, 22/11 03h23 (R-20261122-032334-alexandre): não bloqueia o cancelamento; número vai para inutilização)
      expect(await autorizadas()).toEqual([]);
      const re = await app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, id, { travar: true }))!));
      expect(re.ok).toBe(true);
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id))).toEqual(new Map([[1, 5_000]])); // o reenvio não conta a si mesmo em dobro
      const { tr: tr2 } = transmissor(s);
      expect((await tr2.transmitirNota(A, id)).resultado).toBe('autorizada');
      expect(await aberta()).toBe(false); // autorizada fica fora: o pedido a barra por notasAutorizadas
      expect(await autorizadas()).toEqual([id]);
      expect(await app.comTenant(A, (tx) => repos.notas.quantidadesJaFaturadas(tx, p.pedido_id))).toEqual(new Map([[1, 5_000]]));
    });
  });

  it('regra 4: o total da fila é lido como inteiro (valor grande sem perda) e acima de 2^53 falha em vez de arredondar', async () => {
    const C = await criarTenant(efemero.admin, 'fat-c', ['faturamento']);
    await app.comTenant(C, (tx) => pedidosAprovadosSql.gravar(tx, pedido));
    const total = async (v: string) => {
      await admin(`UPDATE faturamento.pedido_a_faturar SET payload = jsonb_set(payload, '{total_centavos}', '${v}'::jsonb) WHERE tenant_id = $1`, [C]);
      return app.comTenant(C, (tx) => pedidosAprovadosSql.listar(tx, { limite: 50 }, MANAUS));
    };
    expect((await total('9007199254740991')).itens[0]?.total_centavos).toBe(9_007_199_254_740_991);
    await expect(total('9007199254740993')).rejects.toThrow(/faixa segura/);
  });
});
