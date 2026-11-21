/**
 * Despachante da outbox e fila de trabalho no PostgreSQL migrado: a API grava no papel `macuxierp_app`, o worker
 * reserva e despacha no papel `macuxierp_worker` (RLS valendo). Relógio que só anda para a frente a partir do real.
 */
import { randomUUID } from 'node:crypto';
import { criarEvento, type ConsumidorEvento } from '@macuxierp/platform-sdk';
import { FilaDeTrabalhosPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { despacharOutbox } from './despachante';
import { FilaOutboxPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { processarTrabalhos } from './trabalhos';

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
  async function publicar(tenant: string, agregado: string, versao: number) {
    relogio.avancar(1_000);
    const e = criarEvento({ nome: NOME, tenant_id: tenant, agregado_id: agregado, versao, ator: 'sistema', request_id: `r-${versao}`, payload: { versao } }, relogio.agora());
    await app.comTenant(tenant, (tx) => new OutboxPg().gravar(tx, e));
    return e;
  }

  const despachar = (consumidores: ConsumidorEvento[]) =>
    despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores, relogio, log });

  it('entrega cada evento na transação do tenant dele, em ordem, e grava publicado e consumido', async () => {
    const ag = randomUUID();
    const e1 = await publicar(t1, ag, 1);
    const e2 = await publicar(t2, randomUUID(), 1);
    const e3 = await publicar(t1, ag, 2);
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
    expect(await despachar([consumidor])).toEqual({ publicados: 3, falhas: 0, adiados: 0 });
    expect(vistos).toEqual([`${e1.id}:true`, `${e2.id}:true`, `${e3.id}:true`]);
    const { rows } = await b.admin.query('SELECT count(*)::int AS n FROM plataforma.evento WHERE publicado_em IS NULL');
    expect(rows).toEqual([{ n: 0 }]);
    const consumidos = await b.admin.query<{ tenant_id: string; evento_id: string }>('SELECT tenant_id, evento_id FROM plataforma.evento_consumido ORDER BY created_at');
    expect(consumidos.rows.map((c) => `${c.evento_id}:${c.tenant_id}`).sort()).toEqual([e1, e2, e3].map((e) => `${e.id}:${e.tenant_id}`).sort());
    // nada mais a fazer
    expect(await despachar([consumidor])).toEqual({ publicados: 0, falhas: 0, adiados: 0 });
  });

  it('falha aplica backoff e segura o agregado; na volta, quem já consumiu não reaplica', async () => {
    const ag = randomUUID();
    const e1 = await publicar(t1, ag, 1);
    await publicar(t1, ag, 2);
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
    expect(await despachar(consumidores)).toEqual({ publicados: 0, falhas: 1, adiados: 1 });
    const { rows } = await b.admin.query<{ tentativas: number; erro: string; espera: boolean }>(
      'SELECT tentativas, erro, proximo_em > $2 AS espera FROM plataforma.evento WHERE id = $1',
      [e1.id, relogio.agora()],
    );
    expect(rows).toEqual([{ tentativas: 1, erro: 'Error: Hub fora', espera: true }]);
    // antes do backoff vencer, nada do agregado sai (nem a versão 2, que está atrás)
    expect(await despachar(consumidores)).toEqual({ publicados: 0, falhas: 0, adiados: 0 });

    falhar = false;
    relogio.avancar(10_000);
    expect(await despachar(consumidores)).toEqual({ publicados: 2, falhas: 0, adiados: 0 });
    expect(aplicados).toEqual(['ok:1', 'instavel:1', 'ok:2', 'instavel:2']);
  });

  it('um despachante por vez: o segundo sai com lote vazio enquanto o primeiro segura a trava', async () => {
    await publicar(t1, randomUUID(), 1);
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
    expect(await despachar([lento])).toEqual({ publicados: 0, falhas: 0, adiados: 0 });
    liberar();
    expect(await primeiro).toEqual({ publicados: 1, falhas: 0, adiados: 0 });
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
