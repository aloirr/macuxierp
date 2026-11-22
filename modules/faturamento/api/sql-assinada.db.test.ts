/**
 * XML assinado guardado (`nota_xml`, tipo `nfe_assinada`) contra o PostgreSQL real. Depende da migração do banco-dados que aceita o
 * tipo `nfe_assinada` (0020): o CHECK da 0013 o recusa, então ESTE ARQUIVO FALHA até a migração existir. Combinado: só INSERT, várias
 * linhas por nota com `UNIQUE (nota_id, versao) WHERE tipo = 'nfe_assinada'`, protocolo nulo, o INSERT não muda o status da nota.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { criarServicoEmissao } from './emissao';
import { a1DeTeste, depsFake, protocolo, transporteFake, uuid, type Roteiro } from './apoio-teste';
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
        banco: worker,
        notas: repos.notas,
        emissor: s.deps.emissor,
        ambiente: repos.ambiente,
        lerA1: async () => a1DeTeste(),
        sefaz: () => t.transporte,
        agora: () => new Date('2026-11-21T14:30:00Z'),
      }),
    };
  }
  const emitir = async (s: ReturnType<typeof servico>, idem: string) => {
    const r = await app.comTenant(A, (tx) => s.svc.emitirNota(tx, A, { pedido_id: IDS.pedido, idempotencia: idem }));
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

  it('RN-FAT-03: a emissão grava a nfe_assinada versão 1 (protocolo nulo, sha256 do XML) com a nota em rascunho, ANTES da SEFAZ; o worker não assina', async () => {
    const s = servico();
    const nota = await emitir(s, 'idem-assinada-1');
    expect(await admin("SELECT 1 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).toHaveLength(1);
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
    expect((await a.tr.transmitirNota(A, nota.id)).resultado).toBe('aguardando');
    const [guardado] = await admin("SELECT xml FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id]);
    const antes = s.deps.emissor.montar.bind(s.deps.emissor);
    s.deps.emissor.montar = (n, o) => ({ ...antes(n, o), xml: '<NFe data-emissor="v2"/>' });
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
    expect((await admin("SELECT versao FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada' ORDER BY versao", [nota.id])).map((l) => l.versao)).toEqual([1, 2]);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'em_autorizacao' });
    await expect(app.comTenant(A, (tx) => repos.notas.gravarXmlAssinado(tx, nota.id, '<NFe/>', 'a'.repeat(64)))).rejects.toThrow();
    await expect(admin("UPDATE faturamento.nota_xml SET xml = 'x' WHERE nota_id = $1 AND tipo = 'nfe_assinada'", [nota.id])).rejects.toThrow(/imutável/);
    expect((await worker.comTenant(A, (tx) => repos.notas.ultimoXmlAssinado(tx, nota.id)))?.versao).toBe(2);
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
});
