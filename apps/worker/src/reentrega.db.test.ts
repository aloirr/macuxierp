/**
 * T-0045, lote C, no PostgreSQL migrado: a API grava no papel `macuxierp_app`, o worker despacha e reentrega no papel
 * `macuxierp_worker` (RLS valendo). Reentrega desde o início sem duplicar e limite de tentativas com o estado terminal
 * `falhou` sem coluna nova (`publicado_em` + `erro` com `falhou:`). Só tabelas `plataforma.*`; só tenants de teste.
 */
import { randomUUID } from 'node:crypto';
import { criarEvento, type ConsumidorEvento } from '@macuxierp/platform-sdk';
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALERTA_EVENTO_FALHOU, despacharOutbox } from './despachante';
import { FilaOutboxPg, FonteReentregaPg, RegistroConsumoPg } from './pg';
import { reentregarPublicados } from './reentrega';

const log = pino({ level: 'silent' });
const APROVADO = 'pedido.pedido.aprovado@1';
const OUTRO = 'cadastros.cliente.alterado@1';

describe.skipIf(!PG_DISPONIVEL)('reentrega e limite de tentativas no PostgreSQL (papel macuxierp_worker)', () => {
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
    t1 = await criarTenant(b.admin, 'reentrega-um');
    t2 = await criarTenant(b.admin, 'reentrega-dois');
  });
  afterAll(async () => {
    await b?.remover();
  });
  beforeEach(async () => {
    relogio = new RelogioFixo(new Date());
    await b.admin.query('TRUNCATE plataforma.evento_consumido, plataforma.evento, plataforma.trabalho');
  });

  async function publicar(tenant: string, nome = APROVADO, agregado = randomUUID()) {
    relogio.avancar(1_000);
    const e = criarEvento({ nome, tenant_id: tenant, agregado_id: agregado, ator: 'sistema', request_id: 'r-reentrega', payload: { pedido_id: agregado } }, relogio.agora());
    await app.comTenant(tenant, (tx) => new OutboxPg().gravar(tx, e));
    return e;
  }

  const comuns = () => ({ banco: worker, consumo: new RegistroConsumoPg(), relogio, log });
  const despachar = (consumidores: ConsumidorEvento[], extra: { maxTentativas?: number; alertar?: (...a: unknown[]) => void } = {}) =>
    despacharOutbox({ ...comuns(), fila: new FilaOutboxPg(), consumidores, ...extra });
  const reentregar = (consumidores: ConsumidorEvento[], lote = 2) => reentregarPublicados({ ...comuns(), fonte: new FonteReentregaPg(), consumidores, lote });

  it('consumidor ligado depois relê desde o início os aprovados publicados, no tenant de cada um, e a segunda rodada não duplica', async () => {
    const e1 = await publicar(t1);
    const e2 = await publicar(t2);
    const e3 = await publicar(t1);
    await publicar(t1, OUTRO);
    relogio.avancar(1_000);
    // antes da ligação: o despachante publica sem consumidor
    expect(await despachar([])).toMatchObject({ publicados: 4 });

    const vistos: string[] = [];
    const faturamento: ConsumidorEvento = {
      id: 'faturamento.teste-aprovado',
      eventos: [APROVADO, OUTRO],
      tratar: async (e, tx) => {
        const [r] = await tx.consultar<{ t: string }>("SELECT current_setting('app.tenant_id') AS t");
        vistos.push(`${e.id}:${r?.t === e.tenant_id}`);
      },
    };
    expect(await reentregar([faturamento])).toEqual({ entregues: 3, falhas: 0 });
    expect(vistos).toEqual([`${e1.id}:true`, `${e2.id}:true`, `${e3.id}:true`]);
    expect(await reentregar([faturamento])).toEqual({ entregues: 0, falhas: 0 });
    expect(vistos).toHaveLength(3);
    const { rows } = await b.admin.query<{ n: number }>("SELECT count(*)::int AS n FROM plataforma.evento_consumido WHERE consumidor = 'faturamento.teste-aprovado'");
    expect(rows).toEqual([{ n: 3 }]);
    // o despachante também não reaplica (nada pendente)
    expect(await despachar([faturamento])).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
  });

  it('duas partidas ao mesmo tempo: o UNIQUE de evento_consumido segura, cada evento aplicado uma vez', async () => {
    await publicar(t1);
    await publicar(t2);
    relogio.avancar(1_000);
    await despachar([]);
    const aplicados: string[] = [];
    const c: ConsumidorEvento = {
      id: 'faturamento.teste-concorrente',
      eventos: [APROVADO],
      tratar: async (e, tx) => {
        await tx.consultar('SELECT pg_sleep(0.05)');
        aplicados.push(e.id);
      },
    };
    const [r1, r2] = await Promise.all([reentregar([c], 1), reentregar([c], 1)]);
    expect(r1.entregues + r2.entregues).toBeGreaterThanOrEqual(2);
    const { rows } = await b.admin.query<{ n: number; distintos: number }>(
      "SELECT count(*)::int AS n, count(DISTINCT evento_id)::int AS distintos FROM plataforma.evento_consumido WHERE consumidor = 'faturamento.teste-concorrente'",
    );
    expect(rows).toEqual([{ n: 2, distintos: 2 }]);
  });

  it('limite de tentativas: erro determinístico chega a falhou com alerta, libera o agregado e a reentrega não o ressuscita', async () => {
    const ag = randomUUID();
    const e1 = await publicar(t1, APROVADO, ag);
    const e2 = await publicar(t1, OUTRO, ag);
    const alertas: unknown[][] = [];
    const ok: string[] = [];
    const consumidores: ConsumidorEvento[] = [
      { id: 'ok', eventos: [APROVADO, OUTRO], tratar: async (e) => void ok.push(e.id) },
      { id: 'quebrado', eventos: [APROVADO], tratar: async () => { throw new TypeError('payload fora do contrato'); } },
    ];
    const extra = { maxTentativas: 3, alertar: (...a: unknown[]) => void alertas.push(a) };
    const resumos = [];
    for (let i = 0; i < 3; i++) {
      relogio.avancar(3_600_000);
      resumos.push(await despachar(consumidores, extra));
    }
    expect(resumos).toEqual([
      { publicados: 0, falhas: 1, adiados: 1, desistidos: 0 },
      { publicados: 0, falhas: 1, adiados: 1, desistidos: 0 },
      { publicados: 1, falhas: 0, adiados: 0, desistidos: 1 },
    ]);
    const { rows } = await b.admin.query<{ tentativas: number; erro: string; publicado: boolean }>(
      'SELECT tentativas, erro, publicado_em IS NOT NULL AS publicado FROM plataforma.evento WHERE id = $1',
      [e1.id],
    );
    expect(rows).toEqual([{ tentativas: 3, erro: 'falhou: TypeError: payload fora do contrato', publicado: true }]);
    const consumidos = await b.admin.query<{ consumidor: string; evento_id: string }>('SELECT consumidor, evento_id FROM plataforma.evento_consumido ORDER BY consumidor, created_at');
    expect(consumidos.rows).toEqual([
      { consumidor: 'ok', evento_id: e1.id },
      { consumidor: 'ok', evento_id: e2.id },
    ]);
    expect(ok).toEqual([e1.id, e2.id]);
    expect(alertas).toEqual([[t1, ALERTA_EVENTO_FALHOU, { evento_id: e1.id, consumidor: 'quebrado' }]]);
    relogio.avancar(3_600_000);
    expect(await despachar(consumidores, extra)).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
    expect(await reentregar(consumidores)).toEqual({ entregues: 0, falhas: 0 });
  });

  it('limite de tentativas: transitório segue o backoff e publica quando volta', async () => {
    const e1 = await publicar(t2);
    let falhas = 0;
    const c: ConsumidorEvento = {
      id: 'instavel',
      eventos: [APROVADO],
      tratar: async () => {
        if (++falhas <= 2) throw new Error('ECONNRESET');
      },
    };
    const resumos = [];
    for (let i = 0; i < 3; i++) {
      relogio.avancar(3_600_000);
      resumos.push(await despachar([c], { maxTentativas: 3 }));
    }
    expect(resumos.map((r) => [r.publicados, r.falhas, r.desistidos])).toEqual([[0, 1, 0], [0, 1, 0], [1, 0, 0]]);
    const { rows } = await b.admin.query('SELECT tentativas, erro, publicado_em IS NOT NULL AS publicado FROM plataforma.evento WHERE id = $1', [e1.id]);
    expect(rows).toEqual([{ tentativas: 2, erro: null, publicado: true }]);
  });
});
