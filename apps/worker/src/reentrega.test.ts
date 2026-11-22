/**
 * T-0045, lote C: reentrega na partida (consumidor ligado depois do evento publicado) e limite de tentativas do
 * despachante (estado terminal `falhou`, com alerta), com as filas em memória.
 */
import type { ConsumidorEvento } from '@macuxierp/platform-sdk';
import { BancoMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { ALERTA_EVENTO_FALHOU, despacharOutbox, MAX_TENTATIVAS_OUTBOX, PREFIXO_FALHOU } from './despachante';
import { depsConsumidorEstoqueNota, depsConsumidoresPedido } from './consumidores-nota';
import { FilaOutboxMemoria, FonteReentregaMemoria, RegistroConsumoMemoria, ReservaTrabalhosMemoria } from './memoria';
import { EVENTOS_REENTREGA_PADRAO, reentregarPublicados } from './reentrega';
import { iniciarWorker } from './worker';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const AG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INICIO = new Date('2026-11-22T12:00:00Z');
const APROVADO = 'pedido.pedido.aprovado@1';
const log = pino({ level: 'silent' });

let seq = 0;
function evento(agregado: string, segundos: number, nome = APROVADO, tenant = T1) {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    nome,
    tenant_id: tenant,
    agregado_id: agregado,
    versao: seq,
    ocorrido_em: new Date(INICIO.getTime() - 60_000 + segundos * 1000).toISOString(),
    ator: 'sistema' as const,
    request_id: `r${seq}`,
    payload: {},
  };
}

function cenario() {
  const banco = new BancoMemoria();
  const fila = new FilaOutboxMemoria();
  const consumo = new RegistroConsumoMemoria();
  const relogio = new RelogioFixo(INICIO);
  const fonte = new FonteReentregaMemoria(fila, consumo);
  return { banco, fila, consumo, relogio, fonte };
}

describe('reentrega na partida (T-0045)', () => {
  it('consumidor novo recebe desde o início os aprovados já publicados, na transação do tenant, sem duplicar ao rodar de novo', async () => {
    const c = cenario();
    const a1 = evento(AG_A, 1);
    const b1 = evento(AG_B, 2, APROVADO, T2);
    const outro = evento(AG_A, 3, 'cadastros.cliente.alterado@1');
    [a1, b1, outro].forEach((e) => c.fila.adicionar(e));
    // o despachante publica tudo antes de existir o consumidor do faturamento
    expect(await despacharOutbox({ ...c, consumidores: [], log })).toMatchObject({ publicados: 3 });

    const vistos: string[] = [];
    const faturamento: ConsumidorEvento = {
      id: 'faturamento.pedido-aprovado',
      eventos: [APROVADO, 'cadastros.cliente.alterado@1'],
      tratar: async (e, tx) => void vistos.push(`${e.id}:${tenantDaTx(tx)}`),
    };
    const d = { ...c, consumidores: [faturamento], log, lote: 1 };
    expect(await reentregarPublicados(d)).toEqual({ entregues: 2, falhas: 0 });
    // só os nomes da lista (o cliente.alterado fica de fora) e em ordem de ocorrido_em
    expect(vistos).toEqual([`${a1.id}:${T1}`, `${b1.id}:${T2}`]);
    expect(c.consumo.consumidos.has(`faturamento.pedido-aprovado|${a1.id}`)).toBe(true);

    expect(await reentregarPublicados(d)).toEqual({ entregues: 0, falhas: 0 });
    expect(vistos).toHaveLength(2);
  });

  it('não reaplica quem já consumiu nem relê evento pendente ou em falha terminal; a lista de eventos é configurável', async () => {
    const c = cenario();
    const ja = evento(AG_A, 1);
    const pendente = evento(AG_B, 2);
    const morto = evento(AG_B, 3, 'faturamento.nota.autorizada@1');
    [ja, pendente, morto].forEach((e) => c.fila.adicionar(e));
    await c.fila.marcarPublicado(null as never, ja.id, INICIO);
    await c.fila.marcarFalhou(null as never, morto.id, 10, INICIO, `${PREFIXO_FALHOU}Error: x`);
    await c.consumo.registrar(null as never, 'c', ja.id);
    const vistos: string[] = [];
    const consumidor: ConsumidorEvento = { id: 'c', eventos: [APROVADO, 'faturamento.nota.autorizada@1'], tratar: async (e) => void vistos.push(e.id) };
    const d = { ...c, consumidores: [consumidor], log, eventos: [APROVADO, 'faturamento.nota.autorizada@1'] };
    expect(await reentregarPublicados(d)).toEqual({ entregues: 0, falhas: 0 });
    expect(vistos).toEqual([]);
    expect(EVENTOS_REENTREGA_PADRAO).toEqual([APROVADO]);
  });

  it('falha de um evento não para a rodada nem entra em laço; fica para a próxima partida', async () => {
    const c = cenario();
    const e1 = evento(AG_A, 1);
    const e2 = evento(AG_B, 2);
    [e1, e2].forEach((e) => c.fila.adicionar(e));
    await despacharOutbox({ ...c, consumidores: [], log });
    let falhar = true;
    const vistos: string[] = [];
    const consumidor: ConsumidorEvento = {
      id: 'instavel',
      eventos: [APROVADO],
      tratar: async (e) => {
        if (falhar && e.id === e1.id) throw new TypeError('banco fora: CPF 52998224725');
        vistos.push(e.id);
      },
    };
    const { log: logMem, linhas } = pinoEmMemoria();
    const d = { ...c, consumidores: [consumidor], log: logMem, lote: 1 };
    expect(await reentregarPublicados(d)).toEqual({ entregues: 1, falhas: 1 });
    expect(linhas.join('')).toContain('"erro":"TypeError"');
    expect(linhas.join('')).not.toContain('52998224725');
    falhar = false;
    expect(await reentregarPublicados(d)).toEqual({ entregues: 1, falhas: 0 });
    expect(vistos).toEqual([e2.id, e1.id]);
  });

  it('o worker roda a reentrega uma vez, antes do laço; erro de infraestrutura nela não derruba o laço', async () => {
    const c = cenario();
    const e1 = evento(AG_A, 1);
    c.fila.adicionar(e1);
    await despacharOutbox({ ...c, consumidores: [], log });
    const vistos: string[] = [];
    const consumidor: ConsumidorEvento = { id: 'novo', eventos: [APROVADO], tratar: async (e) => void vistos.push(e.id) };
    const base = { ...c, outbox: c.fila, trabalhos: new ReservaTrabalhosMemoria(), consumidores: [consumidor], executores: [], log, intervaloMs: 1 };
    const w = iniciarWorker({ ...base, reentrega: { fonte: c.fonte } });
    for (let i = 0; i < 100 && vistos.length === 0; i++) await new Promise((r) => setImmediate(r));
    await w.parar();
    expect(vistos).toEqual([e1.id]);

    const quebrada = { pendentes: async () => { throw new Error('conexão recusada'); } };
    let ciclos = 0;
    const fila = c.fila;
    const reservar = fila.reservar.bind(fila);
    fila.reservar = async (...a) => (ciclos++, reservar(...a));
    const w2 = iniciarWorker({ ...base, reentrega: { fonte: quebrada } });
    for (let i = 0; i < 200 && ciclos < 2; i++) await new Promise((r) => setTimeout(r, 1));
    await w2.parar();
    expect(ciclos).toBeGreaterThanOrEqual(2);
  });
});

describe('limite de tentativas do despachante (T-0045)', () => {
  function comConsumidor(tratar: ConsumidorEvento['tratar'], maxTentativas?: number) {
    const c = cenario();
    const alertas: unknown[][] = [];
    const ok: string[] = [];
    const consumidores: ConsumidorEvento[] = [
      { id: 'ok', eventos: [APROVADO], tratar: async (e) => void ok.push(e.id) },
      { id: 'faturamento.pedido-aprovado', eventos: [APROVADO], tratar },
    ];
    const d = { ...c, consumidores, log, alertar: (...a: unknown[]) => void alertas.push(a), ...(maxTentativas ? { maxTentativas } : {}) };
    return { c, d, alertas, ok };
  }

  /** Despacha até o evento sair da fila, avançando o relógio além do teto do backoff a cada volta. */
  async function ateSair(c: ReturnType<typeof cenario>, d: Parameters<typeof despacharOutbox>[0], id: string) {
    const resumos = [];
    for (let i = 0; i < 50 && !c.fila.linhas.find((l) => l.id === id)?.publicado_em; i++) {
      resumos.push(await despacharOutbox(d));
      c.relogio.avancar(3_600_000);
    }
    return resumos;
  }

  it('erro determinístico para em N tentativas: falhou, com alerta e registro, e o agregado segue', async () => {
    const { c, d, alertas, ok } = comConsumidor(async () => {
      throw new TypeError('payload sem pedido_id: cliente 52998224725');
    });
    const a1 = evento(AG_A, 1);
    const a2 = evento(AG_A, 2, 'cadastros.cliente.alterado@1');
    [a1, a2].forEach((e) => c.fila.adicionar(e));
    const resumos = await ateSair(c, d, a1.id);
    expect(resumos).toHaveLength(MAX_TENTATIVAS_OUTBOX);
    expect(resumos.at(-1)).toEqual({ publicados: 1, falhas: 0, adiados: 0, desistidos: 1 }); // o a2 sai no mesmo lote
    const linha = c.fila.linhas.find((l) => l.id === a1.id)!;
    expect(linha.tentativas).toBe(MAX_TENTATIVAS_OUTBOX);
    expect(linha.erro).toMatch(/^falhou: TypeError: /);
    expect(linha.publicado_em).not.toBeNull();
    // registro: o consumidor que aplicou ficou registrado (uma vez); o que falhou, não
    expect(ok).toEqual([a1.id]);
    expect(c.consumo.consumidos.has(`ok|${a1.id}`)).toBe(true);
    expect(c.consumo.consumidos.has(`faturamento.pedido-aprovado|${a1.id}`)).toBe(false);
    expect(alertas).toEqual([[T1, ALERTA_EVENTO_FALHOU, { evento_id: a1.id, consumidor: 'faturamento.pedido-aprovado' }]]);
    // nada mais na fila; a reentrega não ressuscita o evento em falha terminal
    expect(await despacharOutbox(d)).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
    expect(await reentregarPublicados({ ...d, fonte: c.fonte })).toEqual({ entregues: 0, falhas: 0 });
  });

  it('erro transitório segue o backoff e publica quando volta, antes do limite (configurável)', async () => {
    let falhas = 0;
    const { c, d, alertas } = comConsumidor(async () => {
      if (++falhas <= 3) throw new Error('ECONNRESET');
    }, 5);
    const a1 = evento(AG_A, 1);
    c.fila.adicionar(a1);
    const resumos = await ateSair(c, d, a1.id);
    expect(resumos.map((r) => r.falhas)).toEqual([1, 1, 1, 0]);
    expect(resumos.at(-1)).toMatchObject({ publicados: 1, desistidos: 0 });
    expect(c.fila.linhas[0]).toMatchObject({ erro: null, tentativas: 3 });
    expect(alertas).toEqual([]);
  });

  it('transitório que não volta chega ao limite configurado e o log leva só o nome do erro', async () => {
    const { log: logMem, linhas } = pinoEmMemoria();
    const { c, d, alertas } = comConsumidor(async () => {
      throw new Error('Hub fora: CPF 52998224725');
    }, 3);
    c.fila.adicionar(evento(AG_A, 1));
    const resumos = await ateSair(c, { ...d, log: logMem }, c.fila.linhas[0]!.id);
    expect(resumos.map((r) => [r.falhas, r.desistidos])).toEqual([[1, 0], [1, 0], [0, 1]]);
    expect(alertas).toHaveLength(1);
    const tudo = linhas.join('');
    expect(tudo).toContain('evento falhou: limite de tentativas');
    expect(tudo).not.toContain('52998224725');
  });
});

describe('dependências dos consumidores das notas (pedido e estoque)', () => {
  it('pedido: outbox, relógio, log e alerta do monitor com módulo pedido e só ids', () => {
    const { log: logMem, registros } = pinoEmMemoria();
    const relogio = new RelogioFixo(INICIO);
    const deps = depsConsumidoresPedido({ log: logMem, relogio });
    expect(deps.relogio).toBe(relogio);
    expect(deps.outbox).toBeDefined();
    deps.alertar(T1, 'acima_do_saldo', { pedido_id: AG_A, motivo: 'texto livre com nome' });
    expect(registros()).toEqual([expect.objectContaining({ alerta: 'acima_do_saldo', modulo: 'pedido', tenant_id: T1, pedido_id: AG_A })]);
    expect(registros()[0]).not.toHaveProperty('motivo');
  });

  it('estoque: repositórios SQL do cadastros, outbox e aviso no log do worker', () => {
    const { log: logMem, registros } = pinoEmMemoria();
    const deps = depsConsumidorEstoqueNota({ log: logMem, relogio: new RelogioFixo(INICIO) });
    expect(typeof deps.repositorios).toBe('function');
    expect(deps.agora()).toEqual(INICIO);
    deps.registrar('estoque-nota: item ignorado');
    expect(registros()).toEqual([expect.objectContaining({ modulo: 'cadastros', msg: 'estoque-nota: item ignorado' })]);
  });
});
