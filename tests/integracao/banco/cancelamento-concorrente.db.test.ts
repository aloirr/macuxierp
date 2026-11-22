/**
 * T-0021 (lote 5 do faturamento): cancelamento do pedido CONCORRENTE com o reenvio da nota, no PostgreSQL real
 * (papéis `macuxierp_app` e `macuxierp_worker`, RLS, gatilhos). Montagem, ordem forçada, matriz e defeitos:
 * docs/testes/T-0021-cancelamento-concorrente.md. Sem Postgres, pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditar, criarEvento, ErroApi, type Transacao } from '../../../packages/platform-sdk/src/index';
import { AuditoriaPg, envelopeDaLinha, OutboxPg, SELECT_EVENTO, type BancoPg, type LinhaEvento } from '../../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RelogioFixo } from '../../../packages/platform-sdk/src/testes';
import { a1DeTeste, depsFake, transporteFake, uuid, type Roteiro } from '../../../modules/faturamento/api/apoio-teste';
import { criarServicoEmissao } from '../../../modules/faturamento/api/emissao';
import { notaEmAbertoSql, pedidosAprovadosSql, repositoriosSql } from '../../../modules/faturamento/api/sql';
import { criarTransmissor } from '../../../modules/faturamento/api/transmissor';
import { itemPedido, pedidoAprovado } from '../../../modules/faturamento/domain/fixtures';
import { consumidoresDoPedido } from '../../../modules/pedido/api/consumidor-nota';
import { criarConsultaParaFaturar } from '../../../modules/pedido/api/faturar';
import { pedidoManual, prepararCadastros } from '../../../modules/pedido/api/fixtures-teste';
import { dependenciasDeProducao } from '../../../modules/pedido/api/index';
import { CadastrosMemoria } from '../../../modules/pedido/api/memoria';
import { criarServico, type Efeitos } from '../../../modules/pedido/api/servico';

const AGORA = new Date('2026-11-22T08:40:00Z'); // 04h40 de Manaus
const USUARIO = '22222222-2222-4222-8222-222222222222';
/** Duas transações que esperam uma pela outra terminam bem antes disso; o `deadlock_timeout` do Postgres é 1 s. */
const PRAZO_MS = 15_000;
const RODADAS = 20;
const QTD = 10_000; // 1 unidade (Qtd4)
const PRECO = 1000; // R$ 10,00

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: unknown };
const capturar = <T>(p: Promise<T>): Promise<Resultado<T>> => p.then((valor) => ({ ok: true as const, valor }), (erro: unknown) => ({ ok: false as const, erro }));
const codigoPg = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** Portão: `parar()` avisa que chegou (`chegou`) e espera o `abrir()`. Sem portão ligado, o gancho não faz nada. */
function portao() {
  let abrir!: () => void;
  let avisar!: () => void;
  const aberto = new Promise<void>((r) => (abrir = r));
  const chegou = new Promise<void>((r) => (avisar = r));
  return { chegou, abrir, parar: async () => { avisar(); await aberto; } };
}
type Portao = ReturnType<typeof portao>;

describe.skipIf(!PG_DISPONIVEL)('T-0021 — cancelamento do pedido × reenvio da nota em paralelo (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let T: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  // ---- pedido ----
  const cad = new CadastrosMemoria();
  /**
   * Ganchos da corrida: o cancelamento para depois da porta `NotaEmAberto` (já com o `FOR UPDATE` do pedido e o `FOR SHARE`
   * da nota); o reenvio, depois do `FOR UPDATE` da nota ou do `FOR SHARE` da situação do pedido; o worker, depois de publicar
   * a `nota.autorizada@1` (nota já autorizada na transação dele, ainda sem commit).
   */
  const g: { aposNotaEmAberto?: Portao; aposSituacao?: Portao; aposTravarNota?: Portao; aposPublicarAutorizada?: Portao } = {};
  // O-01 do doc: a produção ainda liga semNotaEmAberto; aqui, o notaEmAbertoSql pelo `extras`, como a F4
  const servicoPedido = criarServico(dependenciasDeProducao(cad, {
    notas: {
      async temNotaEmAutorizacao(tx, pedido_id) {
        const r = await notaEmAbertoSql.temNotaEmAutorizacao(tx, pedido_id);
        await g.aposNotaEmAberto?.parar();
        return r;
      },
    },
  }));
  const efeitos = (tx: Transacao): Efeitos => ({
    tenant_id: T,
    ator: { tipo: 'usuario', id: USUARIO, perfil: 'gerente' },
    agora: AGORA,
    publicar: async (e) => {
      const ev = criarEvento({ nome: e.nome, tenant_id: T, agregado_id: e.agregado_id, ator: USUARIO, request_id: 'req-t0021', payload: e.payload }, AGORA);
      await new OutboxPg().gravar(tx, ev);
      return ev.id;
    },
    auditar: async (d) => void (await auditar(new AuditoriaPg(), tx, { tenant_id: T, usuario_id: USUARIO, request_id: 'req-t0021' }, d, AGORA)),
  });
  const cancelar = (id: string) =>
    app.comTenant(T, (tx) => servicoPedido.cancelar(tx, efeitos(tx), id, { motivo_codigo: 'solicitacao_cliente', motivo_texto: null }));

  // ---- faturamento ----
  const repos = repositoriosSql({ outbox: new OutboxPg(), agora: () => AGORA });
  const f = depsFake({ ambiente: 'homologacao' });
  const situacaoReal = criarConsultaParaFaturar();
  Object.assign(f.deps, {
    notas: repos.notas, pedidos: pedidosAprovadosSql, ambiente: repos.ambiente,
    situacao: {
      async situacao(tx: Transacao, pedido_id: string) {
        const s = await situacaoReal.situacao(tx, pedido_id);
        await g.aposSituacao?.parar();
        return s;
      },
    },
  });
  const emissao = criarServicoEmissao(f.deps);
  /** O caminho da rota `POST /notas/:id/reenviar` (rotas.ts): nota `FOR UPDATE`, depois `reenviarNota`, na mesma transação. */
  const reenviar = (nota_id: string) =>
    app.comTenant(T, async (tx) => {
      const nota = await repos.notas.obter(tx, nota_id, { travar: true });
      if (!nota) throw new Error('nota sumiu');
      await g.aposTravarNota?.parar();
      return emissao.reenviarNota(tx, nota);
    });
  /** Notas com o publicador espiado: a transação do retorno da SEFAZ (tx2 do worker) para depois de autorizar e publicar. */
  const notasDoWorker = {
    ...repos.notas,
    async publicarEvento(tx: Transacao, e: Parameters<typeof repos.notas.publicarEvento>[1]) {
      await repos.notas.publicarEvento(tx, e);
      await g.aposPublicarAutorizada?.parar();
    },
  };
  const transmissor = (roteiro: Roteiro) => {
    const t = transporteFake(roteiro);
    return criarTransmissor({ banco: worker, notas: notasDoWorker, emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => t.transporte, agora: () => AGORA });
  };

  // ---- consumidor do pedido ----
  const alertas: string[] = [];
  const [consumidor] = consumidoresDoPedido({ outbox: new OutboxPg(), relogio: new RelogioFixo(AGORA), alertar: (_t, codigo) => void alertas.push(codigo) });
  /** Aplica ao pedido cada `nota.autorizada@1` da nota (o despachante do worker faria o mesmo). */
  async function aplicarAutorizadas(nota_id: string): Promise<void> {
    const linhas = await admin(`SELECT ${SELECT_EVENTO} FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'faturamento.nota.autorizada@1' ORDER BY versao`, [nota_id]);
    for (const l of linhas) await worker.comTenant(T, (tx) => consumidor!.tratar(envelopeDaLinha(l as LinhaEvento), tx));
  }

  // ---- massa ----
  let idem = 0;
  interface Caso { pedido_id: string; total: number; nota_id: string; transmissor: ReturnType<typeof transmissor>; roteiro: Roteiro }

  /** Pedido manual aprovado (1 × R$ 10,00), na fila do faturamento, com a nota em `rascunho`. */
  async function pedidoComNota(): Promise<Caso> {
    const p = (await app.comTenant(T, (tx) => servicoPedido.lancar(tx, efeitos(tx), pedidoManual()))).pedido;
    expect(p.status).toBe('aprovado');
    const fila = pedidoAprovado([itemPedido(1, QTD, PRECO)], { pedido_id: p.id, numero: p.numero });
    fila.pedido.condicao_pagamento_id = uuid(77);
    await app.comTenant(T, (tx) => pedidosAprovadosSql.gravar(tx, fila));
    const r = await app.comTenant(T, (tx) => emissao.emitirNota(tx, T, { pedido_id: p.id, idempotencia: `t0021-${++idem}-${randomUUID()}` }));
    if (!r.ok) throw new Error(`emissão recusada: ${r.violacoes.map((v) => v.rn).join(', ')}`);
    const roteiro: Roteiro = {};
    return { pedido_id: p.id, total: p.total_centavos, nota_id: r.nota.id, transmissor: transmissor(roteiro), roteiro };
  }
  /** Nota em `em_autorizacao`: o lote foi recebido (103) e o recibo ainda está em processamento (105). */
  async function emAutorizacao(): Promise<Caso> {
    const c = await pedidoComNota();
    c.roteiro.recibo = () => null;
    expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'aguardando' });
    delete c.roteiro.recibo; // a próxima consulta do recibo autoriza
    expect(await statusNota(c.nota_id)).toBe('em_autorizacao');
    return c;
  }
  /** Nota `rejeitada` (lote rejeitado no envelope, 225): pode ser reenviada com o mesmo número (RN-FAT-07). */
  async function rejeitada(): Promise<Caso> {
    const c = await pedidoComNota();
    c.roteiro.autorizar = () => ({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' });
    expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'rejeitada' });
    delete c.roteiro.autorizar;
    return c;
  }

  const statusNota = async (id: string): Promise<string> => (await admin('SELECT status FROM faturamento.nota WHERE id = $1', [id]))[0]?.status;
  async function estado(c: Caso) {
    const [p] = await admin('SELECT status, valor_faturado_centavos::int AS valor, total_centavos::int AS total FROM pedido.pedido WHERE id = $1', [c.pedido_id]);
    const itens = await admin('SELECT quantidade::float8 AS q, quantidade_faturada::float8 AS f FROM pedido.pedido_item WHERE pedido_id = $1 AND deleted_at IS NULL', [c.pedido_id]);
    const notas = await admin('SELECT status, serie, numero FROM faturamento.nota WHERE pedido_id = $1 AND deleted_at IS NULL', [c.pedido_id]);
    return { pedido: p?.status as string, valor: p?.valor as number, total: p?.total as number, itens, notas };
  }
  /** Invariantes de toda rodada: uma nota por pedido (nenhuma duplicada), faturado nunca acima do pedido. */
  async function conferirSaldo(c: Caso): Promise<Awaited<ReturnType<typeof estado>>> {
    const e = await estado(c);
    expect(e.notas, 'uma nota por pedido').toHaveLength(1);
    expect(e.valor).toBeLessThanOrEqual(e.total);
    for (const i of e.itens) expect(i.f).toBeLessThanOrEqual(i.q);
    return e;
  }
  /** Não terminou em deadlock (40P01). */
  function semTrava(r: Resultado<unknown>, quem: string): void {
    if (!r.ok) expect(codigoPg(r.erro), `${quem}: deadlock (40P01)`).not.toBe('40P01');
  }
  /**
   * 422 `RN-PED-02` da porta `NotaEmAberto` (`servico.ts`, `cancelar`). Distingue da transição inválida (mesmo código) pela
   * palavra "nota" no texto, sem depender de "autorização" (o texto muda quando a porta contar mais situações).
   */
  const ehRecusaNotaEmAberto = (r: Resultado<unknown> | undefined): boolean =>
    !!r && !r.ok && r.erro instanceof ErroApi && r.erro.status === 422 && r.erro.codigo === 'RN-PED-02' && /\bnotas?\b/i.test(r.erro.message);

  /** Espera a outra transação aparecer esperando trava no Postgres, ou terminar; o que vier primeiro. */
  async function esperarBloqueio(outra: Promise<unknown>): Promise<'bloqueada' | 'terminou'> {
    let terminou = false;
    void outra.finally(() => (terminou = true));
    const limite = performance.now() + 5_000;
    while (performance.now() < limite) {
      if (terminou) return 'terminou';
      const [l] = await admin("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
      if ((l?.n ?? 0) > 0) return 'bloqueada';
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('a segunda transação nem esperou trava nem terminou em 5 s');
  }

  /**
   * Corre `primeira` até o portão, solta `segunda`, espera a segunda bloquear (ou terminar) e abre o portão. Tudo com prazo.
   * Devolve os dois resultados e se a segunda chegou a esperar trava.
   */
  async function corrida<A, B>(gancho: keyof typeof g, primeira: () => Promise<A>, segunda: () => Promise<B>) {
    const p = portao();
    g[gancho] = p;
    try {
      const a = capturar(primeira());
      await Promise.race([p.chegou, a]);
      delete g[gancho]; // só a primeira passa pelo portão
      const b = capturar(segunda());
      const como = await esperarBloqueio(b);
      p.abrir();
      const [ra, rb] = await comPrazo(Promise.all([a, b]));
      return { primeira: ra, segunda: rb, segundaBloqueou: como === 'bloqueada' };
    } finally {
      delete g[gancho];
      p.abrir();
    }
  }
  /** Rejeita se as duas transações não terminarem em `PRAZO_MS`. */
  const comPrazo = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error(`trava: as duas transações não terminaram em ${PRAZO_MS} ms`)), PRAZO_MS).unref())]);
  /** Rodada solta, sem portão: as duas ao mesmo tempo, com prazo; nas rodadas ímpares o reenvio sai primeiro. */
  async function soltas(c: Caso, i: number) {
    const reenvAntes = i % 2 === 1 ? capturar(reenviar(c.nota_id)) : undefined;
    const canc = capturar(cancelar(c.pedido_id));
    const [rc, rr] = await comPrazo(Promise.all([canc, reenvAntes ?? capturar(reenviar(c.nota_id))]));
    return { canc: rc, reenv: rr };
  }
  /** Esperado de D-03 e D-03b: nunca pedido `cancelado` com nota autorizada (ou o cancelamento é recusado, ou o worker não autoriza). */
  function nuncaCanceladoComAutorizada(d: { cancelamento?: Resultado<unknown>; transmissao?: unknown; pedido?: string; nota?: string }): void {
    if (d.cancelamento?.ok) {
      expect(d.transmissao).not.toMatchObject({ resultado: 'autorizada' });
      expect(d.nota).not.toBe('autorizada');
    } else {
      expect(ehRecusaNotaEmAberto(d.cancelamento)).toBe(true);
    }
    expect(d.pedido === 'cancelado' && d.nota === 'autorizada').toBe(false);
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    T = await criarTenant(efemero.admin, 't0021-cancelamento', ['pedido', 'faturamento']);
    prepararCadastros(cad, { limite: 1_000_000_000, saldo: 1_000_000_000 });
  }, 180_000);
  afterAll(async () => {
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k]?.abrir();
    await efemero?.remover();
  });

  // ------------------------------------------------------------------ 1. nota em_autorizacao, sem corrida

  it('preparo: nota em_autorizacao → NotaEmAberto = true e o cancelamento é 422 RN-PED-02; o pedido segue aprovado; autorizada, a nota fatura o pedido sem passar o saldo', async () => {
    const c = await emAutorizacao();
    expect(await app.comTenant(T, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, c.pedido_id))).toBe(true);
    const r = await capturar(cancelar(c.pedido_id));
    expect(ehRecusaNotaEmAberto(r)).toBe(true);
    expect((await estado(c)).pedido).toBe('aprovado');
    expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'autorizada' });
    await aplicarAutorizadas(c.nota_id);
    await aplicarAutorizadas(c.nota_id); // reentrega do evento: nada muda
    const e = await conferirSaldo(c);
    expect(e).toMatchObject({ pedido: 'faturado', valor: c.total, notas: [{ status: 'autorizada' }] });
    expect(e.itens).toEqual([{ q: QTD, f: QTD }]);
  });

  // ------------------------------------------------------------------ 2. em_autorizacao × reenvio pela API

  for (const ordem of ['cancelamento primeiro', 'reenvio primeiro'] as const) {
    it(`em_autorizacao × reenvio pela API (${ordem}): cancelamento 422 RN-PED-02, reenvio recusado (RN-FAT-07), sem deadlock, uma nota, depois faturado`, async () => {
      const c = await emAutorizacao();
      const r = ordem === 'cancelamento primeiro'
        ? await corrida('aposNotaEmAberto', () => cancelar(c.pedido_id), () => reenviar(c.nota_id))
        : await corrida('aposTravarNota', () => reenviar(c.nota_id), () => cancelar(c.pedido_id));
      const [canc, reenv] = ordem === 'cancelamento primeiro' ? [r.primeira, r.segunda] : [r.segunda, r.primeira];
      semTrava(canc, 'cancelamento');
      semTrava(reenv, 'reenvio');
      expect(r.segundaBloqueou, 'a segunda transação esperou a trava da primeira').toBe(true);
      expect(ehRecusaNotaEmAberto(canc)).toBe(true);
      expect(reenv).toMatchObject({ ok: true, valor: { ok: false, violacoes: [expect.objectContaining({ rn: 'RN-FAT-07' })] } });
      expect(await estado(c)).toMatchObject({ pedido: 'aprovado', notas: [{ status: 'em_autorizacao' }] });
      expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'autorizada' });
      await aplicarAutorizadas(c.nota_id);
      expect(await conferirSaldo(c)).toMatchObject({ pedido: 'faturado', valor: c.total });
    });
  }

  it(`em_autorizacao × reenvio pela API, ${RODADAS} rodadas soltas (Promise.all, as duas ordens): nunca deadlock, cancelamento sempre 422, uma nota, saldo íntegro`, async () => {
    for (let i = 0; i < RODADAS; i++) {
      const c = await emAutorizacao();
      const { canc, reenv } = await soltas(c, i);
      semTrava(canc, `rodada ${i} cancelamento`);
      semTrava(reenv, `rodada ${i} reenvio`);
      expect(ehRecusaNotaEmAberto(canc), `rodada ${i}`).toBe(true);
      expect(reenv, `rodada ${i}`).toMatchObject({ ok: true, valor: { ok: false } });
      expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'autorizada' });
      await aplicarAutorizadas(c.nota_id);
      expect(await conferirSaldo(c), `rodada ${i}`).toMatchObject({ pedido: 'faturado' });
    }
  }, 120_000);

  // ------------------------------------------------------------------ 3. em_autorizacao × retorno da SEFAZ no worker

  it('em_autorizacao × retorno autorizado no worker (cancelamento primeiro): o FOR SHARE da nota segura o worker; cancelamento 422, depois autorizada e faturado', async () => {
    const c = await emAutorizacao();
    const r = await corrida('aposNotaEmAberto', () => cancelar(c.pedido_id), () => c.transmissor.transmitirNota(T, c.nota_id));
    semTrava(r.primeira, 'cancelamento');
    semTrava(r.segunda, 'worker');
    expect(ehRecusaNotaEmAberto(r.primeira)).toBe(true);
    expect(r.segunda).toMatchObject({ ok: true, valor: { resultado: 'autorizada' } });
    await aplicarAutorizadas(c.nota_id);
    expect(await conferirSaldo(c)).toMatchObject({ pedido: 'faturado', valor: c.total, notas: [{ status: 'autorizada' }] });
  });

  // D-01: o worker autoriza primeiro (a nota sai de em_autorizacao na transação dele) e o cancelamento entra antes do consumidor.
  const d01: { cancelamento?: Resultado<unknown>; pedido?: string; nota?: string; alertas?: string[] } = {};
  it('[D-01, preparo] em_autorizacao × retorno autorizado no worker (worker primeiro): sem deadlock; guarda o que o cancelamento e o consumidor fizeram', async () => {
    const c = await emAutorizacao();
    const antes = alertas.length;
    const r = await corrida('aposPublicarAutorizada', () => c.transmissor.transmitirNota(T, c.nota_id), () => cancelar(c.pedido_id));
    semTrava(r.primeira, 'worker');
    semTrava(r.segunda, 'cancelamento');
    expect(r.segundaBloqueou, 'o cancelamento esperou a trava da nota (FOR SHARE)').toBe(true);
    expect(r.primeira).toMatchObject({ ok: true, valor: { resultado: 'autorizada' } });
    await aplicarAutorizadas(c.nota_id);
    const e = await conferirSaldo(c);
    Object.assign(d01, { cancelamento: r.segunda, pedido: e.pedido, nota: e.notas[0]?.status, alertas: alertas.slice(antes) });
    expect(d01.nota).toBe('autorizada');
  });
  it.fails('[D-01] nota autorizada e ainda não aplicada ao pedido: o cancelamento concorrente é recusado (422 RN-PED-02) e o pedido termina faturado, não cancelado', () => {
    if (!d01.cancelamento) return; // sem o preparo, sai cedo: o it.fails fica vermelho (não falhou)
    expect(ehRecusaNotaEmAberto(d01.cancelamento)).toBe(true);
    expect(d01.pedido).toBe('faturado');
    expect(d01.alertas).toEqual([]);
  });

  // D-02: o mesmo buraco sem corrida nenhuma — nota autorizada com o nota.autorizada@1 ainda na outbox.
  const d02: { cancelamento?: Resultado<unknown>; notaEmAberto?: boolean; pedido?: string; alertas?: string[] } = {};
  it('[D-02, preparo] nota autorizada, evento ainda não consumido: guarda a porta, o cancelamento e o resultado do consumidor', async () => {
    const c = await emAutorizacao();
    expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'autorizada' });
    const antes = alertas.length;
    d02.notaEmAberto = await app.comTenant(T, (tx) => notaEmAbertoSql.temNotaEmAutorizacao(tx, c.pedido_id));
    d02.cancelamento = await capturar(cancelar(c.pedido_id));
    await aplicarAutorizadas(c.nota_id);
    const e = await conferirSaldo(c);
    Object.assign(d02, { pedido: e.pedido, alertas: alertas.slice(antes) });
    expect(e.notas[0]?.status).toBe('autorizada');
  });
  it.fails('[D-02] nota autorizada não aplicada conta como nota em aberto: a porta diz true, o cancelamento é 422 RN-PED-02 e o pedido fica faturado', () => {
    if (!d02.cancelamento) return; // sem o preparo, sai cedo: o it.fails fica vermelho (não falhou)
    expect(d02.notaEmAberto).toBe(true);
    expect(ehRecusaNotaEmAberto(d02.cancelamento)).toBe(true);
    expect(d02.pedido).toBe('faturado');
  });

  // ------------------------------------------------------------------ 4. rejeitada × reenvio pela API

  it('rejeitada × reenvio pela API (cancelamento primeiro): o reenvio espera o FOR UPDATE do pedido no FOR SHARE da situação e é recusado (RN-PED-02); o worker não transmite; pedido cancelado e nota rejeitada', async () => {
    const c = await rejeitada();
    const r = await corrida('aposNotaEmAberto', () => cancelar(c.pedido_id), () => reenviar(c.nota_id));
    semTrava(r.primeira, 'cancelamento');
    semTrava(r.segunda, 'reenvio');
    expect(r.segundaBloqueou, 'o reenvio esperou a trava do pedido (FOR SHARE da situação)').toBe(true);
    expect(r.primeira).toMatchObject({ ok: true, valor: { status: 'cancelado' } });
    expect(r.segunda).toMatchObject({ ok: true, valor: { ok: false, violacoes: [expect.objectContaining({ rn: 'RN-PED-02' })] } });
    expect(await c.transmissor.transmitirNota(T, c.nota_id)).toMatchObject({ resultado: 'ignorada' });
    expect(await conferirSaldo(c)).toMatchObject({ pedido: 'cancelado', valor: 0, notas: [{ status: 'rejeitada' }] });
  });

  // D-03: o reenvio confirma primeiro (a nota segue `rejeitada`, com conteúdo novo e trabalho na fila); o cancelamento passa.
  const d03: { cancelamento?: Resultado<unknown>; reenvio?: Resultado<unknown>; transmissao?: unknown; pedido?: string; nota?: string; alertas?: string[] } = {};
  it('[D-03, preparo] rejeitada × reenvio pela API (reenvio primeiro): sem deadlock; guarda o cancelamento, a transmissão do worker e o estado final', async () => {
    const c = await rejeitada();
    const antes = alertas.length;
    const r = await corrida('aposSituacao', () => reenviar(c.nota_id), () => cancelar(c.pedido_id));
    semTrava(r.primeira, 'reenvio');
    semTrava(r.segunda, 'cancelamento');
    expect(r.segundaBloqueou, 'o cancelamento esperou o FOR SHARE do reenvio no pedido').toBe(true);
    expect(r.primeira).toMatchObject({ ok: true, valor: { ok: true } });
    d03.transmissao = await c.transmissor.transmitirNota(T, c.nota_id); // o trabalho que a rota enfileirou
    await aplicarAutorizadas(c.nota_id);
    const e = await conferirSaldo(c);
    Object.assign(d03, { cancelamento: r.segunda, reenvio: r.primeira, pedido: e.pedido, nota: e.notas[0]?.status, alertas: alertas.slice(antes) });
  });
  it.fails('[D-03] nota reenviada (rejeitada com reenvio na fila) segura o cancelamento, ou o worker não transmite nota de pedido cancelado: nunca pedido cancelado com nota autorizada', () => {
    if (!d03.cancelamento) return; // sem o preparo, sai cedo: o it.fails fica vermelho (não falhou)
    nuncaCanceladoComAutorizada(d03);
  });

  // D-03b: o mesmo buraco sem corrida — nota `rascunho` recém-emitida, o cancelamento passa e o worker assina e autoriza depois.
  const d03b: { cancelamento?: Resultado<unknown>; transmissao?: unknown; pedido?: string; nota?: string } = {};
  it('[D-03b, preparo] nota rascunho recém-emitida, cancelamento sem corrida, depois o worker transmite: guarda o cancelamento, a transmissão e o estado final', async () => {
    const c = await pedidoComNota();
    expect(await statusNota(c.nota_id)).toBe('rascunho');
    d03b.cancelamento = await capturar(cancelar(c.pedido_id));
    semTrava(d03b.cancelamento, 'cancelamento');
    d03b.transmissao = await c.transmissor.transmitirNota(T, c.nota_id); // o trabalho que a emissão enfileirou
    await aplicarAutorizadas(c.nota_id);
    const e = await conferirSaldo(c);
    Object.assign(d03b, { pedido: e.pedido, nota: e.notas[0]?.status });
  });
  it.fails('[D-03b] nota rascunho na fila segura o cancelamento, ou o worker não assina nota de pedido cancelado: nunca pedido cancelado com nota autorizada', () => {
    if (!d03b.cancelamento) return; // sem o preparo, sai cedo: o it.fails fica vermelho (não falhou)
    nuncaCanceladoComAutorizada(d03b);
  });

  it(`rejeitada × reenvio pela API, ${RODADAS} rodadas soltas (Promise.all, as duas ordens): nunca deadlock, respostas do domínio, uma nota, saldo íntegro`, async () => {
    for (let i = 0; i < RODADAS; i++) {
      const c = await rejeitada();
      const { canc, reenv } = await soltas(c, i);
      semTrava(canc, `rodada ${i} cancelamento`);
      semTrava(reenv, `rodada ${i} reenvio`);
      expect(canc.ok || ehRecusaNotaEmAberto(canc), `rodada ${i}: cancelamento ok ou 422`).toBe(true);
      expect(reenv.ok, `rodada ${i}: o reenvio devolve resultado do domínio, sem exceção`).toBe(true);
      await c.transmissor.transmitirNota(T, c.nota_id);
      await aplicarAutorizadas(c.nota_id);
      await conferirSaldo(c);
    }
  }, 120_000);
});
