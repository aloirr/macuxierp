/**
 * XML assinado guardado (`nota_xml`, tipo `nfe_assinada`) contra o PostgreSQL real. Depende da migração do banco-dados que aceita o
 * tipo `nfe_assinada` (0020): o CHECK da 0013 o recusa, então ESTE ARQUIVO FALHA até a migração existir. Combinado: só INSERT, várias
 * linhas por nota com `UNIQUE (nota_id, versao) WHERE tipo = 'nfe_assinada'`, protocolo nulo, o INSERT não muda o status da nota.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemPedido, pedidoAprovado } from '../domain/fixtures';
import { criarServicoEmissao } from './emissao';
import { a1DeTeste, a1VencidoDeTeste, depsFake, protocolo, transporteFake, pedidoNovoNaFila, uuid, type Roteiro } from './apoio-teste';
import { pedidosAprovadosSql, repositoriosSql } from './sql';
import { criarTransmissor } from './transmissor';

describe.skipIf(!PG_DISPONIVEL)('XML assinado guardado em nota_xml (PostgreSQL real, migração 0020)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
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
  const emitir = async (s: ReturnType<typeof servico>, idem: string) => {
    const r = await app.comTenant(A, async (tx) => s.svc.emitirNota(tx, A, { pedido_id: await pedidoNovoNaFila(tx, pedidosAprovadosSql.gravar), idempotencia: idem }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    return r.nota;
  };

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'fat-assinada', ['faturamento']);
    await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, pedido));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FAT-03: a API emite SEM nfe_assinada (nota em rascunho); o WORKER (papel macuxierp_worker) assina, grava a versão 1 (protocolo nulo, sha256 do XML) com a nota em rascunho e só então vai a em_autorizacao, ANTES da SEFAZ', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-1');
    expect(nota.status).toBe('rascunho');
    expect(await admin("SELECT 1 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).toHaveLength(0);
    const { tr, t } = transmissor(s, { recibo: () => null }); // 105: a nota segue em_autorizacao
    expect((await tr.transmitirNota(A, nota.id)).resultado).toBe('aguardando');
    expect(t.chamadas).toEqual(['autorizar', 'consultarRecibo']);
    const linhas = await admin("SELECT versao, protocolo, xml, sha256, tipo FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ versao: 1, protocolo: null, tipo: 'nfe_assinada' });
    expect(linhas[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'em_autorizacao' });
  });

  it('RN-FAT-03: troca do emissor entre o envio e o retry: o retry reutiliza o assinado guardado e o nfeProc autorizado o contém', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-2');
    let pronto = false;
    const a = transmissor(s, { recibo: (c) => (pronto ? protocolo(c) : null) });
    expect((await a.tr.transmitirNota(A, nota.id)).resultado).toBe('aguardando'); // assina (v1) e envia
    const [guardado] = await admin("SELECT xml FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id]);
    const antes = s.emissor.montar.bind(s.emissor);
    s.emissor.montar = (n, o) => ({ ...antes(n, o), xml: '<NFe data-emissor="v2"/>' });
    pronto = true;
    expect((await a.tr.transmitirNota(A, nota.id)).resultado).toBe('autorizada');
    expect(await admin("SELECT 1 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).toHaveLength(1);
    const [aut] = await admin("SELECT xml FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_autorizada'", [nota.id]);
    expect(aut?.xml).toContain(guardado?.xml);
    expect(aut?.xml).not.toContain('data-emissor');
  });

  it('RN-FAT-07: o reenvio da rejeitada reassina com a nota ainda rejeitada e grava a versão 2 (max+1); em em_autorizacao o banco recusa a nfe_assinada (0020) e o assinado é imutável', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-3');
    const { tr } = transmissor(s, { recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
    expect((await tr.transmitirNota(A, nota.id)).resultado).toBe('rejeitada');
    const re = await app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, nota.id, { travar: true }))!));
    expect(re.ok).toBe(true);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'rejeitada' }); // a API só refez o conteúdo
    expect((await admin("SELECT versao FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada' ORDER BY versao", [nota.id])).map((l) => l.versao)).toEqual([1]);
    const { tr: tr2 } = transmissor(s, { recibo: () => null }); // o worker reassina com a nota ainda rejeitada (0020) e vai a em_autorizacao
    expect((await tr2.transmitirNota(A, nota.id)).resultado).toBe('aguardando');
    expect((await admin("SELECT versao FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada' ORDER BY versao", [nota.id])).map((l) => l.versao)).toEqual([1, 2]);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'em_autorizacao' });
    await expect(app.comTenant(A, (tx) => repos.notas.gravarXmlAssinado(tx, nota.id, '<NFe/>', 'a'.repeat(64)))).rejects.toThrow();
    await expect(admin("UPDATE faturamento.nota_xml SET xml = 'x' WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).rejects.toThrow(/imutável/);
    expect((await worker.comTenant(A, (tx) => repos.notas.ultimoXmlAssinado(tx, nota.id)))?.versao).toBe(2);
  });

  it('RN-CORE-06 / RN-FAT-07: A1 vencido entre as fases: o worker deixa a nota em rascunho com o motivo em transporte.envio_pendente, sem nfe_assinada e sem queimar número; o reenvio limpa o motivo e sai com o mesmo número', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-5');
    const t = transporteFake();
    const vencido = criarTransmissor({ log: () => undefined, banco: worker, notas: repos.notas, titulos: repos.titulos, emissor: s.emissor, ambiente: repos.ambiente, lerA1: async () => a1VencidoDeTeste(), sefaz: () => t.transporte, agora: () => new Date('2026-11-21T14:30:00Z') });
    expect(await vencido.transmitirNota(A, nota.id)).toEqual({ resultado: 'nao_assinada', motivo: 'a1_invalido' });
    const [n] = await admin("SELECT status, numero, transporte->'envio_pendente'->>'motivo' AS motivo FROM faturamento.nota WHERE id = $1", [nota.id]);
    expect(n).toMatchObject({ status: 'rascunho', numero: nota.numero });
    expect(n?.motivo).toMatch(/A1_FORA_DA_VALIDADE/);
    expect(await admin("SELECT 1 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).toHaveLength(0);
    expect(t.chamadas).toEqual([]);
    const re = await app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, nota.id, { travar: true }))!));
    expect(re.ok && re.nota).toMatchObject({ numero: nota.numero, status: 'rascunho' });
    expect((await admin("SELECT transporte->'envio_pendente' AS p FROM faturamento.nota WHERE id = $1", [nota.id]))[0]?.p).toBeNull();
    const { tr } = transmissor(s);
    expect((await tr.transmitirNota(A, nota.id)).resultado).toBe('autorizada');
    expect((await admin('SELECT numero, chave_acesso FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ numero: nota.numero, chave_acesso: nota.chave_acesso });
    expect(await app.comTenant(A, (tx) => tx.consultar('SELECT * FROM faturamento.buracos_numeracao()'))).toEqual([]);
  });

  it('RN-FAT-03: a trava por nota: com a nota travada por outra transação, a transmissão sai sem fazer nada', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-4');
    const { tr, t } = transmissor(s);
    let liberar!: () => void;
    const segurando = new Promise<void>((r) => (liberar = r));
    const preso = worker.comTenant(A, async (tx) => {
      expect(await repos.notas.travarTransmissao(tx, nota.id)).toBe(true);
      await segurando;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await tr.transmitirNota(A, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'em_transmissao' });
    expect(t.chamadas).toEqual([]);
    liberar();
    await preso;
  });
  it('RN-FAT-07 e RN-FAT-03: corrida worker × reenvio: o worker trava a nota (FOR UPDATE) e o reenvio da API espera; o XML assinado é o da revisão lida e o reenvio, depois, é recusado (nota em em_autorizacao)', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-corrida-1');
    const t = transporteFake({ recibo: () => null });
    let reenvio: Promise<{ ok: boolean }> | undefined;
    let reenvioTerminou = false;
    const tr = criarTransmissor({
      log: () => undefined,
      banco: worker,
      notas: repos.notas, titulos: repos.titulos,
      emissor: s.emissor,
      ambiente: repos.ambiente,
      // O A1 é lido DENTRO da tx1, já com a linha travada: aqui a API tenta reenviar e tem de ficar esperando.
      lerA1: async () => {
        reenvio = app.comTenant(A, async (tx) => s.svc.reenviarNota(tx, (await repos.notas.obter(tx, nota.id, { travar: true }))!)).finally(() => (reenvioTerminou = true));
        await new Promise((r) => setTimeout(r, 500));
        expect(reenvioTerminou).toBe(false);
        return a1DeTeste();
      },
      sefaz: () => t.transporte,
      agora: () => new Date('2026-11-21T14:30:00Z'),
    });
    expect((await tr.transmitirNota(A, nota.id)).resultado).toBe('aguardando');
    const re = await reenvio!;
    expect(re.ok).toBe(false); // a nota já está em em_autorizacao: o reenvio não troca o conteúdo sob o XML assinado
    const [n] = await admin("SELECT status, COALESCE((transporte->>'revisao')::int, 1) AS revisao FROM faturamento.nota WHERE id = $1", [nota.id]);
    expect(n).toMatchObject({ status: 'em_autorizacao', revisao: 1 });
    expect((await admin("SELECT versao FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).map((l) => l.versao)).toEqual([1]);
  });

  it('RN-FAT-07: o UPDATE para em_autorizacao exige a revisão lida: com a revisão já trocada pela API, o banco não pega e a tx desfaz (nada de XML antigo em em_autorizacao)', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-corrida-2');
    await app.comTenant(A, (tx) => s.svc.reenviarNota(tx, nota)); // revisão 2 (nota em rascunho)
    await expect(worker.comTenant(A, (tx) => repos.notas.mudarStatus(tx, nota.id, 'rascunho', 'em_autorizacao', { revisao: 1 }))).rejects.toThrow(/RN-FAT-02.*revisão 1/);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'rascunho' });
    await worker.comTenant(A, (tx) => repos.notas.mudarStatus(tx, nota.id, 'rascunho', 'em_autorizacao', { revisao: 2 }));
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'em_autorizacao' });
  });

  /** O gatilho `tocar_updated_at` devolveria o relógio a now(): desliga só para recuar o `updated_at` do teste. */
  const recuar = async (id: string, intervalo: string, extra = ''): Promise<void> => {
    await admin('ALTER TABLE faturamento.nota DISABLE TRIGGER tocar_updated_at');
    try {
      await admin(`UPDATE faturamento.nota SET ${extra}updated_at = now() - interval '${intervalo}' WHERE id = $1`, [id]);
    } finally {
      await admin('ALTER TABLE faturamento.nota ENABLE TRIGGER tocar_updated_at');
    }
  };

  it('RN-FAT-07: a varredura pega o rascunho sem nfe_assinada parado há N min (30 com envio_pendente); numeradasNaoEnviadas lista rascunho e rejeitada antigas (prazo de inutilização, RN-FAT-01)', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-varredura-1');
    expect(await worker.comTenant(A, (tx) => repos.notas.pendentesDeTransmissao(tx, 500, 2, 30))).not.toContainEqual({ id: nota.id, status: 'rascunho' }); // recém-criada
    await recuar(nota.id, '5 minutes');
    expect(await worker.comTenant(A, (tx) => repos.notas.pendentesDeTransmissao(tx, 500, 2, 30))).toContainEqual({ id: nota.id, status: 'rascunho' });
    await recuar(nota.id, '5 minutes', `transporte = transporte || '{"envio_pendente":{"motivo":"x"}}'::jsonb, `);
    expect(await worker.comTenant(A, (tx) => repos.notas.pendentesDeTransmissao(tx, 500, 2, 30))).not.toContainEqual({ id: nota.id, status: 'rascunho' });
    await recuar(nota.id, '40 minutes');
    expect(await worker.comTenant(A, (tx) => repos.notas.pendentesDeTransmissao(tx, 500, 2, 30))).toContainEqual({ id: nota.id, status: 'rascunho' });
    const emitida = new Date((await admin('SELECT emitida_em FROM faturamento.nota WHERE id = $1', [nota.id]))[0]?.emitida_em as string).getTime();
    expect((await worker.comTenant(A, (tx) => repos.notas.numeradasNaoEnviadas(tx, new Date(emitida - 1)))).map((n) => n.id)).not.toContain(nota.id);
    const antigas = await worker.comTenant(A, (tx) => repos.notas.numeradasNaoEnviadas(tx, new Date(emitida + 86_400_000)));
    expect(antigas.find((n) => n.id === nota.id)).toMatchObject({ status: 'rascunho', numero: nota.numero, serie: nota.serie });
  });
});
