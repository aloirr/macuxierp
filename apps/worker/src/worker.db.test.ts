/**
 * Despachante da outbox e fila de trabalho no PostgreSQL migrado: a API grava no papel `macuxierp_app`, o worker
 * reserva e despacha no papel `macuxierp_worker` (RLS valendo). Relógio que só anda para a frente a partir do real.
 * Integração com o FDV montada como no `main.ts` (T-0016): `montarAgendas` e `montarConsumidores` com os adaptadores PG,
 * o laço real (`rodarAgendas`, `despacharOutbox`) e um DUBLÊ do `ClienteHub` (nunca a rede); recebedor e resolvedor
 * dublês (o recebimento de verdade é testado no `pedidos-fdv.db.test.ts` e no `integracao-fdv`). Só tenants de teste.
 * O dublê do Hub, a resposta `ok`, a credencial e a chave mestra vêm do apoio de teste do módulo
 * (`@macuxierp/integracao-fdv/api/testes`, RD-0512; R-20261122-042502).
 */
import { createHash, randomUUID } from 'node:crypto';
import { AGENDA_BUSCA_PEDIDOS_ID, AGENDA_CONECTOR_ID, AGENDA_RETORNO_PEDIDOS_ID } from '@macuxierp/integracao-fdv/api';
import { CHAVE_MESTRA, criarCredencial, hubDuble, ok } from '@macuxierp/integracao-fdv/api/testes';
import { armazenamentoIndisponivel, criarEvento, type ClienteHub, type ConsumidorEvento } from '@macuxierp/platform-sdk';
import { CatalogoArquivosPg, FilaDeTrabalhosPg, LicencasPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rodarAgendas } from './agenda';
import { pinoEmMemoria } from './apoio-teste';
import { configurarCredenciais, criarDecifradorCredencial } from './credencial';
import { despacharOutbox } from './despachante';
import { configurarEnvioFdv, type EstadoEnvioFdv } from './envio-fdv';
import { configurarHub } from './hub';
import { montarAgendas, montarConsumidores, montarExecutores, montarRotinas } from './modulos';
import { conferirRecebimentoFdv, configurarRecebimentoFdv, criarAlertaMonitor, type EstadoRecebimentoFdv, type MontagemPedidosFdv } from './pedidos-fdv';
import { FilaOutboxPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { processarTrabalhos } from './trabalhos';
import { ciclo } from './worker';

const log = pino({ level: 'silent' });
const NOME = 'cadastros.cliente.alterado@1';

describe.skipIf(!PG_DISPONIVEL)('worker no PostgreSQL (papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let t1: string;
  let t2: string;
  let relogio: RelogioFixo;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app');
    worker = b.banco('macuxierp_worker');
    t1 = await criarTenant(b.admin, 'worker-um');
    t2 = await criarTenant(b.admin, 'worker-dois');
  });
  afterAll(async () => {
    await b?.remover();
  });
  beforeEach(async () => {
    relogio = new RelogioFixo(new Date());
    await b.admin.query('TRUNCATE plataforma.evento_consumido, plataforma.evento, plataforma.trabalho');
  });

  /** Grava pela API (outbox na transação do tenant). O instante anda 1 s por evento: a ordem de ocorrido_em é a da gravação. */
  async function publicar(tenant: string, agregado: string) {
    relogio.avancar(1_000);
    const e = criarEvento({ nome: NOME, tenant_id: tenant, agregado_id: agregado, ator: 'sistema', request_id: 'r-worker', payload: {} }, relogio.agora());
    const versao = await app.comTenant(tenant, (tx) => new OutboxPg().gravar(tx, e));
    return { ...e, versao };
  }

  const despachar = (consumidores: ConsumidorEvento[]) =>
    despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores, relogio, log });

  it('entrega cada evento na transação do tenant dele, em ordem, e grava publicado e consumido', async () => {
    const ag = randomUUID();
    const e1 = await publicar(t1, ag);
    const e2 = await publicar(t2, randomUUID());
    const e3 = await publicar(t1, ag);
    const vistos: string[] = [];
    const consumidor: ConsumidorEvento = {
      id: 'integracao-fdv.teste',
      eventos: [NOME],
      tratar: async (e, tx) => {
        const [r] = await tx.consultar<{ t: string }>("SELECT current_setting('app.tenant_id') AS t");
        vistos.push(`${e.id}:${r?.t === e.tenant_id}`);
      },
    };
    relogio.avancar(1_000);
    expect(await despachar([consumidor])).toEqual({ publicados: 3, falhas: 0, adiados: 0, desistidos: 0 });
    expect(vistos).toEqual([`${e1.id}:true`, `${e2.id}:true`, `${e3.id}:true`]);
    const { rows } = await b.admin.query('SELECT count(*)::int AS n FROM plataforma.evento WHERE publicado_em IS NULL');
    expect(rows).toEqual([{ n: 0 }]);
    const consumidos = await b.admin.query<{ tenant_id: string; evento_id: string }>('SELECT tenant_id, evento_id FROM plataforma.evento_consumido ORDER BY created_at');
    expect(consumidos.rows.map((c) => `${c.evento_id}:${c.tenant_id}`).sort()).toEqual([e1, e2, e3].map((e) => `${e.id}:${e.tenant_id}`).sort());
    // nada mais a fazer
    expect(await despachar([consumidor])).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
  });

  it('falha aplica backoff e segura o agregado; na volta, quem já consumiu não reaplica', async () => {
    const ag = randomUUID();
    const e1 = await publicar(t1, ag);
    await publicar(t1, ag);
    let falhar = true;
    const aplicados: string[] = [];
    const consumidores: ConsumidorEvento[] = [
      { id: 'ok', eventos: [NOME], tratar: async (e) => void aplicados.push(`ok:${e.versao}`) },
      {
        id: 'instavel',
        eventos: [NOME],
        tratar: async (e) => {
          if (falhar) throw new Error('Hub fora');
          aplicados.push(`instavel:${e.versao}`);
        },
      },
    ];
    relogio.avancar(1_000);
    expect(await despachar(consumidores)).toEqual({ publicados: 0, falhas: 1, adiados: 1, desistidos: 0 });
    const { rows } = await b.admin.query<{ tentativas: number; erro: string; espera: boolean }>(
      'SELECT tentativas, erro, proximo_em > $2 AS espera FROM plataforma.evento WHERE id = $1',
      [e1.id, relogio.agora()],
    );
    expect(rows).toEqual([{ tentativas: 1, erro: 'Error: Hub fora', espera: true }]);
    // antes do backoff vencer, nada do agregado sai (nem a versão 2, que está atrás)
    expect(await despachar(consumidores)).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });

    falhar = false;
    relogio.avancar(10_000);
    expect(await despachar(consumidores)).toEqual({ publicados: 2, falhas: 0, adiados: 0, desistidos: 0 });
    expect(aplicados).toEqual(['ok:1', 'instavel:1', 'ok:2', 'instavel:2']);
  });

  it('um despachante por vez: o segundo sai com lote vazio enquanto o primeiro segura a trava', async () => {
    await publicar(t1, randomUUID());
    relogio.avancar(1_000);
    let liberar!: () => void;
    const segurando = new Promise<void>((r) => (liberar = r));
    let entrou!: () => void;
    const dentro = new Promise<void>((r) => (entrou = r));
    const lento: ConsumidorEvento = {
      id: 'lento',
      eventos: [NOME],
      tratar: async () => {
        entrou();
        await segurando;
      },
    };
    const primeiro = despachar([lento]);
    await dentro;
    expect(await despachar([lento])).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
    liberar();
    expect(await primeiro).toEqual({ publicados: 1, falhas: 0, adiados: 0, desistidos: 0 });
  });

  it('fila de trabalho: enfileira pela API e o worker executa no tenant do trabalho', async () => {
    const { id } = await app.comTenant(t2, (tx) => new FilaDeTrabalhosPg().enfileirar(tx, { tipo: 'cadastros.consultar_ie', tenant_id: t2, payload: { uf: 'AM' } }));
    relogio.avancar(1_000);
    const resumo = await processarTrabalhos({
      banco: worker,
      fila: new ReservaTrabalhosPg(),
      relogio,
      log,
      executores: [
        {
          tipo: 'cadastros.consultar_ie',
          executar: async (t, tx) => {
            const [r] = await tx.consultar<{ t: string }>("SELECT current_setting('app.tenant_id') AS t");
            return { uf: t.payload.uf, tenant: r?.t };
          },
        },
      ],
    });
    expect(resumo).toEqual({ concluidos: 1, falhas: 0, desistidos: 0 });
    const { rows } = await b.admin.query('SELECT estado, resultado FROM plataforma.trabalho WHERE id = $1', [id]);
    expect(rows).toEqual([{ estado: 'concluido', resultado: { uf: 'AM', tenant: t2 } }]);
  });

  it('fila de trabalho: falha com backoff e desiste em maxTentativas', async () => {
    const { id } = await app.comTenant(t1, (tx) => new FilaDeTrabalhosPg().enfileirar(tx, { tipo: 'core.exportar', tenant_id: t1, payload: {} }));
    relogio.avancar(1_000);
    const rodar = () =>
      processarTrabalhos({ banco: worker, fila: new ReservaTrabalhosPg(), relogio, log, executores: [{ tipo: 'core.exportar', maxTentativas: 2, executar: async () => { throw new Error('S3 fora'); } }] });
    expect(await rodar()).toMatchObject({ falhas: 1 });
    expect(await rodar()).toMatchObject({ falhas: 0, desistidos: 0 });
    relogio.avancar(10_000);
    expect(await rodar()).toMatchObject({ desistidos: 1 });
    const { rows } = await b.admin.query('SELECT estado, tentativas, erro FROM plataforma.trabalho WHERE id = $1', [id]);
    expect(rows).toEqual([{ estado: 'falhou', tentativas: 2, erro: 'Error: S3 fora' }]);
  });
});

describe.skipIf(!PG_DISPONIVEL)('worker com o integracao-fdv montado (PostgreSQL, papel macuxierp_worker, Hub dublê)', () => {
  // Uma linha do tempo só: o instante real da coleta, que o RelogioFixo de cada teste faz andar.
  const AGORA = new Date();
  const LONGE = new Date(AGORA.getTime() + 100 * 365 * 86_400_000);
  const decifrarCredencial = criarDecifradorCredencial(new Map([[1, CHAVE_MESTRA]]));
  const ids = { cliente: randomUUID(), vendedor: randomUUID(), produto: randomUUID(), filial: randomUUID() };
  let b: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let relogio: RelogioFixo;
  const adm = async (sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const recebidos: string[] = [];

  /** As peças do `montarPedidosFdv` com recebedor e resolvedor dublês; o alerta é o do monitor (pino real). */
  function pedidosFdv(recebimento: EstadoRecebimentoFdv, log: pino.Logger): MontagemPedidosFdv {
    const conhecidas = new Set<string>(Object.values(ids));
    return {
      recebimento,
      recebedor: { receber: async (_tx, e) => (recebidos.push(e.pedido_uuid), { resultado: 'criado', pedido_id: randomUUID(), numero: 7, status: 'aprovado' }) },
      resolvedor: { resolver: async (_tx, _e, chaves) => new Map(chaves.filter((c) => conhecidas.has(c)).map((c) => [c, c])) },
      alertar: criarAlertaMonitor(log),
    };
  }

  /** Uma rodada do laço de agenda com a montagem do `main.ts`. */
  function rodada(recebimento: EstadoRecebimentoFdv, hub: ClienteHub, envio: EstadoEnvioFdv = 'ligado') {
    const { log: pinoLog, linhas } = pinoEmMemoria();
    const agendas = montarAgendas({ log: pinoLog, relogio, pedidosFdv: pedidosFdv(recebimento, pinoLog), envio });
    return { linhas, resumo: rodarAgendas(agendas, { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log: pinoLog }) };
  }

  /** Outbox → consumidores do `montarConsumidores` (o retorno do pedido grava o `retorno_enviado`). */
  const despacharConsumidores = () =>
    despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores: montarConsumidores({ log, relogio }), relogio, log });

  /** Tenant com os módulos e a credencial do conector (`criarCredencial` do apoio do módulo, cifrada com a `CHAVE_MESTRA` dele). */
  async function tenantComCredencial(slug: string, modulos: string[], ambiente: 'teste' | 'producao' = 'teste'): Promise<{ t: string; conector: string; chave: string }> {
    const t = await criarTenant(b.admin, slug, modulos);
    const conector = `conector-${slug}`;
    const chave = `chave-de-teste-${slug}-${randomUUID()}`;
    await criarCredencial(b.admin, t, { conector, ambiente, chave });
    return { t, conector, chave };
  }

  async function sinal(t: string, o: { busca?: Date | null; retorno?: Date | null }): Promise<void> {
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em) VALUES ($1, $2, $2, $3, $4)', [t, LONGE, o.busca ?? null, o.retorno ?? null]);
    await adm(`INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, fonte_ocorrido_em) VALUES ($1, 'filial_padrao', $2, $3)`, [t, ids.filial, AGORA]);
  }
  const lerSinal = async (t: string) => (await adm('SELECT proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;

  /** O `pedido.pedido.recebido@1` que o módulo pedido publica (aqui pela API, no papel `macuxierp_app`). */
  async function publicarRecebido(t: string, uuid: string): Promise<void> {
    const pedido = randomUUID();
    const e = criarEvento({ nome: 'pedido.pedido.recebido@1', tenant_id: t, agregado_id: pedido, ator: 'sistema', request_id: 'r-worker-fdv', payload: { pedido_id: pedido, numero: 7, origem: 'fdv', pedido_uuid: uuid, status: 'aprovado' } }, relogio.agora());
    await app.comTenant(t, (tx) => new OutboxPg().gravar(tx, e));
  }

  const pedidoDoHub = (uuid: string) => ({
    pedido_uuid: uuid, cliente_external_id: ids.cliente, vendedor_external_id: ids.vendedor, criado_em: new Date(AGORA.getTime() - 3_600_000).toISOString(), total_cents: 2500, tentativa: 1,
    itens: [{ sequencia: 1, produto_external_id: ids.produto, quantidade: 2.5, preco_unitario_cents: 1000, total_cents: 2500 }],
  });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app');
    worker = b.banco('macuxierp_worker');
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });
  beforeEach(() => {
    relogio = new RelogioFixo(AGORA);
  });
  // Cada teste estaciona as agendas dos seus tenants: a reserva é de todos os tenants e não pode vazar para o seguinte.
  afterEach(async () => {
    await adm('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $1', [LONGE]);
    await adm('UPDATE integracao_fdv.sinal SET proximo_sinal_em = $1, proxima_reconciliacao_em = $1, proxima_busca_pedidos_em = $1, proximo_retorno_em = $1', [LONGE]);
  });

  it('RF-INF-02: o conector montado envia o lote ao Hub, confirma na consulta e publica lote.enviado@1 pela OutboxPg da fábrica', async () => {
    const { t, conector, chave } = await tenantComCredencial('worker-conector', ['integracao-fdv']);
    const payload = { ativo: true, external_id: 'P001', nome: 'Produto P001', sku: 'SKU-P001', unidade: 'UN' }; // chaves já em ordem: o JSON é o canônico
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await adm(
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente)
       VALUES ($1, 'produto', 'P001', $2::jsonb, $3, $4, $4, '{}'::jsonb, true, true)`,
      [t, JSON.stringify(payload), hash, new Date(AGORA.getTime() - 3_600_000)],
    );
    await adm('INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em, cursor_alterado_em, cursor_external_id) VALUES ($1, $2, $3, $4, $5)', [
      t, 'produto', new Date(AGORA.getTime() - 60_000), new Date(AGORA.getTime() - 86_400_000), 'ANTIGO',
    ]);
    const lote = randomUUID();
    const hub = hubDuble({
      'POST /lotes': [ok({ lote_id: lote, status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 1, repetido: false, consulta: `/integracao/v1/lotes/${lote}` })],
      'GET /lotes/{id}': [ok({ lote_id: lote, entidade: 'produto', modo: 'delta', status: 'concluido', contagens: { recebidas: 1, com_erro: 0, novas: 1 }, erros: [] }, false, 200)],
    });

    const r1 = rodada('desligado', hub);
    expect(await r1.resumo).toEqual({ executados: 1, falhas: 0, semLicenca: 0 });
    expect(hub.chamadas.map((c) => `${c.pedido.metodo} ${c.pedido.caminho}`)).toEqual(['POST /lotes']);
    expect(hub.chamadas[0]!.cred).toEqual({ conectorId: conector, chave, ambiente: 'teste' });
    expect((hub.chamadas[0]!.pedido.corpo as { registros: Array<{ external_id: string }> }).registros.map((x) => x.external_id)).toEqual(['P001']);
    expect(await adm('SELECT estado, hub_lote_id FROM integracao_fdv.lote_envio WHERE tenant_id = $1', [t])).toEqual([{ estado: 'aceito', hub_lote_id: lote }]);

    relogio.avancar(6_000);
    expect(await rodada('desligado', hub).resumo).toEqual({ executados: 1, falhas: 0, semLicenca: 0 });
    expect(hub.chamadas.map((c) => c.pedido.metodo)).toEqual(['POST', 'GET']);
    expect(await adm('SELECT estado FROM integracao_fdv.lote_envio WHERE tenant_id = $1', [t])).toEqual([{ estado: 'concluido' }]);
    expect(await adm('SELECT pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1', [t])).toEqual([{ pendente: false }]);
    expect((await adm("SELECT nome FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE 'integracao-fdv.%'", [t])).map((e) => e.nome)).toEqual(['integracao-fdv.lote.enviado@1']);
    // a chave do conector nunca vai ao log (regra 9)
    expect(r1.linhas.join('')).not.toContain(chave);
  });

  it('RN-PED-01 e RN-PED-05, ligado: a busca entrega o pedido ao recebedor; o consumidor grava o retorno e a agenda o envia ao Hub', async () => {
    const { t, conector } = await tenantComCredencial('worker-ligado', ['integracao-fdv', 'pedido']);
    await sinal(t, { busca: new Date(AGORA.getTime() - 5_000) });
    const uuid = randomUUID();
    const hub = hubDuble({
      'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [pedidoDoHub(uuid)] }, false, 200)],
      [`POST /pedidos/${uuid}/retorno`]: [ok({ repetido: false }, false, 200)],
    });

    const busca = rodada('ligado', hub);
    expect(await busca.resumo).toEqual({ executados: 1, falhas: 0, semLicenca: 0 });
    expect(recebidos).toContain(uuid);
    expect(hub.chamadas.map((c) => [c.cred.conectorId, `${c.pedido.metodo} ${c.pedido.caminho}`])).toEqual([[conector, 'GET /pedidos/pendentes?limite=50']]);
    expect(await adm('SELECT estado FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [t, uuid])).toEqual([{ estado: 'entregue' }]);
    expect((await lerSinal(t)).proxima_busca_pedidos_em.getTime()).toBe(AGORA.getTime() + 60_000);

    relogio.avancar(1_000);
    await publicarRecebido(t, uuid);
    relogio.avancar(1_000);
    expect(await despacharConsumidores()).toMatchObject({ publicados: 1, falhas: 0 });
    expect(await adm('SELECT status, estado, numero_erp FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1', [t])).toEqual([{ status: 'integrado', estado: 'pendente', numero_erp: '7' }]);

    relogio.avancar(1_000);
    const retorno = rodada('ligado', hub);
    expect(await retorno.resumo).toEqual({ executados: 1, falhas: 0, semLicenca: 0 });
    const envio = hub.chamadas[1]!;
    expect(envio.pedido).toMatchObject({ metodo: 'POST', caminho: `/pedidos/${uuid}/retorno` });
    expect(envio.pedido.corpo).toMatchObject({ versao_contrato: 'v1', pedido_uuid: uuid, status: 'integrado', numero_erp: '7' });
    expect(await adm('SELECT estado FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1', [t])).toEqual([{ estado: 'enviado' }]);
    expect((await lerSinal(t)).proximo_retorno_em).toBeNull(); // nada mais pendente
  });

  it('desligado: nem a busca nem o retorno rodam (nenhuma chamada de pedido ao Hub, colunas intocadas); o consumidor só grava a fila local', async () => {
    const { t } = await tenantComCredencial('worker-desligado', ['integracao-fdv', 'pedido']);
    const vencida = new Date(AGORA.getTime() - 5_000);
    await sinal(t, { busca: vencida });
    const uuid = randomUUID();
    await adm(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado) VALUES ($1, $2, '{}', repeat('c', 64), 'entregue')`, [t, uuid]);
    await publicarRecebido(t, uuid);
    relogio.avancar(1_000);
    expect(await despacharConsumidores()).toMatchObject({ publicados: 1, falhas: 0 });
    // o consumidor grava o retorno pendente e agenda a coluna, sem tocar no Hub
    expect(await adm('SELECT estado FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1', [t])).toEqual([{ estado: 'pendente' }]);
    const retornoAgendado = (await lerSinal(t)).proximo_retorno_em as Date;
    expect(retornoAgendado.getTime()).toBeLessThanOrEqual(relogio.agora().getTime());
    const hub = hubDuble({
      'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [] }, false, 200)],
      [`POST /pedidos/${uuid}/retorno`]: [ok({ repetido: false }, false, 200)],
    });

    relogio.avancar(1_000);
    const { linhas, resumo } = rodada('desligado', hub);
    expect(await resumo).toEqual({ executados: 0, falhas: 0, semLicenca: 0 });
    expect(hub.chamadas).toEqual([]);
    expect((await lerSinal(t)).proxima_busca_pedidos_em.getTime()).toBe(vencida.getTime());
    expect(((await lerSinal(t)).proximo_retorno_em as Date).getTime()).toBe(retornoAgendado.getTime());
    expect(await adm('SELECT estado FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1', [t])).toEqual([{ estado: 'pendente' }]);
    expect(linhas.join('')).not.toContain(AGENDA_BUSCA_PEDIDOS_ID);
    expect(linhas.join('')).not.toContain(AGENDA_RETORNO_PEDIDOS_ID);
  });

  it('MACUXIERP_FDV_ENVIO=desligado (trava de 22/11): com credencial gravada e tudo vencido, o Hub não recebe nenhuma chamada', async () => {
    const { t } = await tenantComCredencial('worker-envio-desligado', ['integracao-fdv', 'pedido']);
    const vencida = new Date(AGORA.getTime() - 60_000);
    const payload = { ativo: true, external_id: 'P002', nome: 'Produto P002', sku: 'SKU-P002', unidade: 'UN' };
    await adm(
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente)
       VALUES ($1, 'produto', 'P002', $2::jsonb, $3, $4, $4, '{}'::jsonb, true, true)`,
      [t, JSON.stringify(payload), createHash('sha256').update(JSON.stringify(payload)).digest('hex'), new Date(AGORA.getTime() - 3_600_000)],
    );
    await adm('INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em) VALUES ($1, $2, $3)', [t, 'produto', vencida]);
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $2)', [t, vencida]);
    const lote = randomUUID();
    const hub = hubDuble({
      'POST /lotes': [ok({ lote_id: lote, status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 1, repetido: false, consulta: `/integracao/v1/lotes/${lote}` })],
      'POST /sinal': [ok({}, false, 200)],
      'POST /reconciliacoes': [ok({}, false, 200)],
    });

    const desligado = rodada('desligado', hub, 'desligado');
    expect(await desligado.resumo).toEqual({ executados: 0, falhas: 0, semLicenca: 0 });
    expect(hub.chamadas).toEqual([]);
    expect(desligado.linhas.join('')).not.toContain(AGENDA_CONECTOR_ID);
    // nada reservado: as colunas seguem vencidas no banco e nenhum lote foi montado
    expect((await adm('SELECT proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [t]))[0]!.proximo_em.getTime()).toBe(vencida.getTime());
    const [s] = await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
    expect([s!.proximo_sinal_em.getTime(), s!.proxima_reconciliacao_em.getTime()]).toEqual([vencida.getTime(), vencida.getTime()]);
    expect(await adm('SELECT id FROM integracao_fdv.lote_envio WHERE tenant_id = $1', [t])).toEqual([]);

    // contraprova: a mesma montagem com o envio ligado chama o Hub (o sinal escreve; a leitura do cursor sem cursor local
    // corre dentro da tarefa `envio`, por isso cai junto com a agenda; o dublê não responde o cursor e o lote não sai)
    const ligado = rodada('desligado', hub, 'ligado');
    await ligado.resumo;
    expect(hub.chamadas.map((c) => `${c.pedido.metodo} ${c.pedido.caminho}`)).toEqual(['POST /sinal', 'GET /cursores/produto']);
  });

  it('trava mantida na v0.2.0 (R-20261122-061838): com o ambiente do compose.yml, chave e credencial gravada, o laço inteiro não faz nenhum fetch', async () => {
    const { t } = await tenantComCredencial('worker-trava-v020', ['integracao-fdv', 'pedido', 'cadastros'], 'producao');
    const vencida = new Date(AGORA.getTime() - 60_000);
    // tudo vencido: envio (registro pendente e cursor), sinal, reconciliação, busca de pedidos e retorno pendente
    const payload = { ativo: true, external_id: 'P003', nome: 'Produto P003', sku: 'SKU-P003', unidade: 'UN' };
    await adm(
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente)
       VALUES ($1, 'produto', 'P003', $2::jsonb, $3, $4, $4, '{}'::jsonb, true, true)`,
      [t, JSON.stringify(payload), createHash('sha256').update(JSON.stringify(payload)).digest('hex'), new Date(AGORA.getTime() - 3_600_000)],
    );
    await adm('INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em) VALUES ($1, $2, $3)', [t, 'produto', vencida]);
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em) VALUES ($1, $2, $2, $2)', [t, vencida]);
    const uuid = randomUUID();
    await adm(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado) VALUES ($1, $2, '{}', repeat('d', 64), 'entregue')`, [t, uuid]);
    await publicarRecebido(t, uuid); // o consumidor do laço grava o retorno pendente e vence o proximo_retorno_em

    // Espelho do serviço macuxierp-worker do compose.yml (os dois interruptores fixos em desligado; URLs fixas) mais a chave do .env.
    const ENV_COMPOSE = {
      MACUXIERP_HUB_URL_PRODUCAO: 'https://api.macuxifdv.com.br/integracao/v1',
      MACUXIERP_HUB_URL_TESTE: 'https://hub-teste.invalid/integracao/v1',
      MACUXIERP_FDV_RECEBIMENTO: 'desligado',
      MACUXIERP_FDV_ENVIO: 'desligado',
      MACUXIERP_CHAVE_INTEGRACAO: CHAVE_MESTRA.toString('hex'),
    };
    // Dublê na rede: todo fetch do cliente real do Hub cai aqui (qualquer método e caminho, leitura incluída), e o fetch global também é espionado.
    const urls: string[] = [];
    const fetchDuble = (async (u: URL | string, init?: RequestInit) => (urls.push(`${init?.method ?? 'GET'} ${String(u)}`), new Response('{}', { status: 200 }))) as typeof fetch;
    const global = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('o worker não pode chamar a rede');
    });

    /** Montagem do `main.ts` com o ambiente dado: hub, credenciais, interruptores, agendas, consumidores, executores e rotinas. */
    async function ciclos(env: Record<string, string>, n: number): Promise<string[]> {
      const { log: pinoLog, linhas } = pinoEmMemoria();
      const hub = configurarHub(env, '0.2.0', fetchDuble);
      const decifrar = configurarCredenciais(env);
      expect([hub, decifrar].every(Boolean)).toBe(true); // laço de agenda ligado: o que segura o Hub são só os interruptores
      const recebimento = configurarRecebimentoFdv(env);
      const envio = configurarEnvioFdv(env);
      conferirRecebimentoFdv(recebimento, []);
      const d = {
        banco: worker,
        outbox: new FilaOutboxPg(),
        trabalhos: new ReservaTrabalhosPg(),
        consumo: new RegistroConsumoPg(),
        consumidores: montarConsumidores({ log: pinoLog, relogio }),
        executores: montarExecutores({ banco: worker, log: pinoLog, armazenamento: armazenamentoIndisponivel, catalogo: new CatalogoArquivosPg(), agora: () => relogio.agora() }),
        rotinas: montarRotinas({ banco: worker, log: pinoLog }),
        agenda: { agendas: montarAgendas({ log: pinoLog, relogio, pedidosFdv: pedidosFdv(recebimento, pinoLog), envio }), licencas: new LicencasPg(), hub: hub!, decifrarCredencial: decifrar! },
        relogio,
        log: pinoLog,
      };
      const estado = new Map();
      for (let i = 0; i < n; i++) {
        await ciclo(d, estado);
        relogio.avancar(20 * 60_000); // 20 min por ciclo: passa a curva de 5 s a 15 min e o intervalo do sinal
      }
      return linhas;
    }

    try {
      const linhas = await ciclos(ENV_COMPOSE, 6);
      expect(urls).toEqual([]);
      expect(global).not.toHaveBeenCalled();
      expect(linhas.join('')).not.toContain(CHAVE_MESTRA.toString('hex'));
      // o laço rodou de verdade: o consumidor gravou o retorno local; nada foi reservado nem montado para o Hub
      expect(await adm('SELECT estado FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1', [t])).toEqual([{ estado: 'pendente' }]);
      expect(await adm('SELECT id FROM integracao_fdv.lote_envio WHERE tenant_id = $1', [t])).toEqual([]);
      expect((await adm('SELECT proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [t]))[0]!.proximo_em.getTime()).toBe(vencida.getTime());
      const [s] = await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
      expect([s!.proximo_sinal_em, s!.proxima_reconciliacao_em, s!.proxima_busca_pedidos_em].map((x: Date) => x.getTime())).toEqual([vencida.getTime(), vencida.getTime(), vencida.getTime()]);

      // contraprova: o mesmo laço com os dois ligados chama o Hub de produção (pelo dublê), então o zero acima vem da trava
      await ciclos({ ...ENV_COMPOSE, MACUXIERP_FDV_RECEBIMENTO: 'ligado', MACUXIERP_FDV_ENVIO: 'ligado' }, 1);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => u.includes(' https://api.macuxifdv.com.br/integracao/v1/'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/integracao/v1/sinal'))).toBe(true);
      expect(urls.some((u) => u.includes('/integracao/v1/pedidos/pendentes'))).toBe(true);
      expect(global).not.toHaveBeenCalled();
    } finally {
      global.mockRestore();
    }
  });
});
