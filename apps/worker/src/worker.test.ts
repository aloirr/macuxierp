import type { ConsumidorEvento, ExecutorTrabalho } from '@macuxierp/platform-sdk';
import { BancoMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { proximaTentativa } from './backoff';
import { despacharOutbox } from './despachante';
import { FilaOutboxMemoria, ReservaTrabalhosMemoria, RegistroConsumoMemoria } from './memoria';
import { processarTrabalhos } from './trabalhos';
import { ciclo, iniciarWorker } from './worker';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const AG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INICIO = new Date('2026-11-21T15:00:00Z');
const log = pino({ level: 'silent' });

let seq = 0;
function evento(agregado: string, segundos: number, nome = 'cadastros.cliente.alterado@1', tenant = T1) {
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

function cenario(consumidores: ConsumidorEvento[]) {
  const banco = new BancoMemoria();
  const fila = new FilaOutboxMemoria();
  const consumo = new RegistroConsumoMemoria();
  const relogio = new RelogioFixo(INICIO);
  return { banco, fila, consumo, relogio, d: { banco, fila, consumo, relogio, consumidores, log } };
}

describe('despachante da outbox', () => {
  it('entrega em ordem de ocorrido_em, na transação do tenant do evento, e marca publicado', async () => {
    const vistos: string[] = [];
    const c = cenario([{ id: 'integracao-fdv.hub', eventos: ['cadastros.cliente.alterado@1'], tratar: async (e, tx) => void vistos.push(`${e.versao}:${tenantDaTx(tx)}`) }]);
    const e2 = evento(AG_B, 2, undefined, T2);
    const e1 = evento(AG_A, 1);
    c.fila.adicionar(e2);
    c.fila.adicionar(e1);
    expect(await despacharOutbox(c.d)).toEqual({ publicados: 2, falhas: 0, adiados: 0 });
    expect(vistos).toEqual([`${e1.versao}:${T1}`, `${e2.versao}:${T2}`]);
    expect(c.banco.aberturas[0]).toBeNull(); // a reserva roda sem tenant (papel do worker)
    expect(c.fila.linhas.every((l) => l.publicado_em)).toBe(true);
  });

  it('evento sem consumidor é publicado; consumidor de outro evento não recebe', async () => {
    const c = cenario([{ id: 'x', eventos: ['pedido.pedido.aprovado@1'], tratar: async () => { throw new Error('não deveria'); } }]);
    c.fila.adicionar(evento(AG_A, 1));
    expect(await despacharOutbox(c.d)).toMatchObject({ publicados: 1, falhas: 0 });
  });

  it('falha segura a ordem do agregado, aplica backoff e não reaplica quem já consumiu', async () => {
    let falhar = true;
    const aplicados: string[] = [];
    const c = cenario([
      { id: 'ok', eventos: ['cadastros.cliente.alterado@1'], tratar: async (e) => void aplicados.push(`ok:${e.versao}`) },
      {
        id: 'instavel',
        eventos: ['cadastros.cliente.alterado@1'],
        tratar: async (e) => {
          if (falhar) throw new Error('Hub fora: cliente 52998224725');
          aplicados.push(`instavel:${e.versao}`);
        },
      },
    ]);
    const a1 = evento(AG_A, 1);
    const a2 = evento(AG_A, 2);
    const b1 = evento(AG_B, 3);
    [a1, a2, b1].forEach((e) => c.fila.adicionar(e));

    expect(await despacharOutbox(c.d)).toEqual({ publicados: 0, falhas: 2, adiados: 1 });
    const linhaA1 = c.fila.linhas.find((l) => l.id === a1.id)!;
    expect(linhaA1).toMatchObject({ tentativas: 1, publicado_em: null });
    expect(linhaA1.proximo_em).toEqual(proximaTentativa(INICIO, 1));
    expect(linhaA1.erro).toContain('Hub fora');
    expect(c.fila.linhas.find((l) => l.id === a2.id)).toMatchObject({ tentativas: 0, publicado_em: null });

    // antes do backoff vencer, nada do agregado A sai (nem o a2, que está atrás do a1)
    expect(await despacharOutbox(c.d)).toEqual({ publicados: 0, falhas: 0, adiados: 0 });

    falhar = false;
    c.relogio.avancar(10_000);
    expect(await despacharOutbox(c.d)).toEqual({ publicados: 3, falhas: 0, adiados: 0 });
    // o consumidor "ok" aplicou cada evento uma vez só, apesar das retentativas
    expect(aplicados.filter((x) => x === `ok:${a1.versao}`)).toHaveLength(1);
    expect(aplicados).toContain(`instavel:${a2.versao}`);
  });

  it('o log da falha leva o tipo do erro, sem a mensagem (pode ter dado pessoal)', async () => {
    const linhas: string[] = [];
    const logCapturado = pino({ level: 'info' }, { write: (s: string) => void linhas.push(s) });
    const c = cenario([{ id: 'c', eventos: ['cadastros.cliente.alterado@1'], tratar: async () => { throw new TypeError('CPF 52998224725'); } }]);
    c.fila.adicionar(evento(AG_A, 1));
    await despacharOutbox({ ...c.d, log: logCapturado });
    const tudo = linhas.join('');
    expect(tudo).toContain('"erro":"TypeError"');
    expect(tudo).toContain(`"tenant_id":"${T1}"`);
    expect(tudo).not.toContain('52998224725');
  });
});

describe('fila de trabalho', () => {
  function filaCom(executor: ExecutorTrabalho) {
    const banco = new BancoMemoria();
    const fila = new ReservaTrabalhosMemoria();
    const relogio = new RelogioFixo(INICIO);
    fila.adicionar('t1', { tipo: executor.tipo, tenant_id: T2, payload: { uf: 'AM' } }, INICIO);
    fila.adicionar('t2', { tipo: 'outro.tipo', tenant_id: T2, payload: {} }, INICIO);
    return { banco, fila, relogio, d: { banco, fila, relogio, executores: [executor], log } };
  }

  it('executa na transação do tenant do trabalho e guarda o resultado; tipo sem executor fica na fila', async () => {
    const c = filaCom({ tipo: 'cadastros.consultar_ie', executar: async (t, tx) => ({ uf: t.payload.uf, tenant: tenantDaTx(tx) }) });
    expect(await processarTrabalhos(c.d)).toEqual({ concluidos: 1, falhas: 0, desistidos: 0 });
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'concluido', resultado: { uf: 'AM', tenant: T2 } });
    expect(c.fila.linhas[1]).toMatchObject({ estado: 'pendente' });
  });

  it('falha com backoff e desiste em maxTentativas', async () => {
    const c = filaCom({ tipo: 'core.exportar', maxTentativas: 2, executar: async () => { throw new Error('S3 fora'); } });
    expect(await processarTrabalhos(c.d)).toMatchObject({ falhas: 1 });
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'pendente', tentativas: 1 });
    expect(await processarTrabalhos(c.d)).toMatchObject({ falhas: 0, desistidos: 0 }); // backoff ainda não venceu
    c.relogio.avancar(10_000);
    expect(await processarTrabalhos(c.d)).toMatchObject({ desistidos: 1 });
    expect(c.fila.linhas[0]).toMatchObject({ estado: 'falhou', tentativas: 2, erro: 'Error: S3 fora' });
  });

  it('sem executor registrado não abre transação', async () => {
    const banco = new BancoMemoria();
    expect(await processarTrabalhos({ banco, fila: new ReservaTrabalhosMemoria(), relogio: new RelogioFixo(INICIO), executores: [], log })).toEqual({ concluidos: 0, falhas: 0, desistidos: 0 });
    expect(banco.aberturas).toEqual([]);
  });
});

describe('laço do worker', () => {
  it('um ciclo despacha a outbox e os trabalhos; parar() encerra o laço', async () => {
    const banco = new BancoMemoria();
    const outbox = new FilaOutboxMemoria();
    const trabalhos = new ReservaTrabalhosMemoria();
    const relogio = new RelogioFixo(INICIO);
    outbox.adicionar(evento(AG_A, 1));
    trabalhos.adicionar('t1', { tipo: 'core.exportar', tenant_id: T1, payload: {} }, INICIO);
    const d = { banco, outbox, trabalhos, consumo: new RegistroConsumoMemoria(), consumidores: [], executores: [{ tipo: 'core.exportar', executar: async () => null }], relogio, log, intervaloMs: 5 };
    expect(await ciclo(d)).toBe(true);
    expect(await ciclo(d)).toBe(false);

    outbox.adicionar(evento(AG_B, 2));
    const w = iniciarWorker(d);
    for (let i = 0; i < 50 && !outbox.linhas.every((l) => l.publicado_em); i++) await new Promise((r) => setImmediate(r));
    await w.parar();
    expect(outbox.linhas.every((l) => l.publicado_em)).toBe(true);
  });

  it('erro de infraestrutura no ciclo não derruba o laço', async () => {
    const banco = new BancoMemoria();
    let chamadas = 0;
    banco.semTenant = async () => {
      chamadas++;
      throw new Error('conexão recusada');
    };
    const d = { banco, outbox: new FilaOutboxMemoria(), trabalhos: new ReservaTrabalhosMemoria(), consumo: new RegistroConsumoMemoria(), consumidores: [], executores: [], relogio: new RelogioFixo(INICIO), log, intervaloMs: 1 };
    const w = iniciarWorker(d);
    for (let i = 0; i < 200 && chamadas < 2; i++) await new Promise((r) => setTimeout(r, 1));
    await w.parar();
    expect(chamadas).toBeGreaterThanOrEqual(2);
  });
});
