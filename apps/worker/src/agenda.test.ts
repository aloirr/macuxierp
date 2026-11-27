/** Laço de agenda (contrato C-9, T-0009 §6.1) com banco e agenda em memória; a rodada no PostgreSQL fica em `agenda.db.test.ts`. */
import { randomBytes } from 'node:crypto';
import { cifrarCampo, POSSE_AGENDA_MS, type AgendaModulo, type ClienteHub, type FonteLicencas, type ItemAgenda, type Licenca } from '@macuxierp/platform-sdk';
import { BancoMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { rodarAgendas } from './agenda';
import { criarDecifradorCredencial } from './credencial';
import { registrarAgendas } from './modulos';
import { ciclo } from './worker';
import { FilaOutboxMemoria, RegistroConsumoMemoria, ReservaTrabalhosMemoria } from './memoria';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const INICIO = new Date('2026-11-21T15:00:00Z');
const hub: ClienteHub = { chamar: async () => ({ tipo: 'ok', status: 200, corpo: null, replay: false }) };
const CHAVE_MESTRA = randomBytes(32);
const decifrarCredencial = criarDecifradorCredencial(new Map([[1, CHAVE_MESTRA]]));

/** Licenças por tenant (só o `integracao-fdv` importa aqui). */
function licencas(licenciados: string[]): FonteLicencas {
  return { ler: async (_tx, t): Promise<Licenca[]> => (licenciados.includes(t) ? [{ modulo: 'integracao-fdv', ativo: true, valido_ate: null }] : []) };
}

/** Log que guarda os objetos (para provar o que vai e o que não vai). */
function logGravador() {
  const linhas: Record<string, unknown>[] = [];
  const log = pino({ level: 'info' }, { write: (s: string) => void linhas.push(JSON.parse(s) as Record<string, unknown>) });
  return { log, linhas };
}

/** Agenda em memória: devolve os itens na ordem e grava o que aconteceu com cada um. */
function agendaMemoria(itens: ItemAgenda[], executar?: (i: ItemAgenda) => Promise<void>) {
  const vistos: string[] = [];
  const reservas: { tenant: string | null; limite: number; agora: Date; posseAte: Date }[] = [];
  const agenda: AgendaModulo = {
    id: 'integracao-fdv.teste',
    modulo: 'integracao-fdv',
    reservar: async (tx, limite, agora, posseAte) => {
      reservas.push({ tenant: tenantDaTx(tx), limite, agora, posseAte });
      return itens.splice(0, limite);
    },
    executar: async (item, ctx) => {
      const tenant = await ctx.emTransacao(async (tx) => tenantDaTx(tx));
      vistos.push(`executar:${item.tarefa}:${item.chave}:${tenant}:${ctx.hub === hub}`);
      await executar?.(item);
    },
    semLicenca: async (item, tx) => void vistos.push(`semLicenca:${item.tarefa}:${tenantDaTx(tx)}`),
  };
  return { agenda, vistos, reservas };
}

describe('rodarAgendas', () => {
  it('reserva sem tenant com a posse de 2 min e executa em ordem, com emTransacao no tenant do item', async () => {
    const banco = new BancoMemoria();
    const relogio = new RelogioFixo(INICIO);
    const a = agendaMemoria([
      { tenant_id: T1, tarefa: 'envio', chave: 'cliente' },
      { tenant_id: T2, tarefa: 'sinal', chave: null },
      { tenant_id: T1, tarefa: 'envio', chave: 'produto' },
    ]);
    const r = await rodarAgendas([a.agenda], { banco, licencas: licencas([T1, T2]), hub, decifrarCredencial, relogio, log: pino({ level: 'silent' }), lote: 10 });
    expect(r).toEqual({ executados: 3, falhas: 0, semLicenca: 0 });
    expect(a.reservas).toEqual([{ tenant: null, limite: 10, agora: INICIO, posseAte: new Date(INICIO.getTime() + POSSE_AGENDA_MS) }]);
    expect(a.vistos).toEqual([`executar:envio:cliente:${T1}:true`, `executar:sinal:null:${T2}:true`, `executar:envio:produto:${T1}:true`]);
    // reserva sem tenant; licença e emTransacao no tenant do item
    expect(banco.aberturas).toEqual([null, T1, T1, T2, T2, T1, T1]);
  });

  it('limite padrão de 10 itens por agenda e rodada', async () => {
    const a = agendaMemoria(Array.from({ length: 15 }, () => ({ tenant_id: T1, tarefa: 'envio', chave: 'cliente' })));
    const d = { banco: new BancoMemoria(), licencas: licencas([T1]), hub, decifrarCredencial, relogio: new RelogioFixo(INICIO), log: pino({ level: 'silent' }) };
    expect(await rodarAgendas([a.agenda], d)).toMatchObject({ executados: 10 });
    expect(await rodarAgendas([a.agenda], d)).toMatchObject({ executados: 5 });
  });

  it('passa o posseAte da reserva e para o lote a 30 s do fim da posse (os restantes voltam pela posse)', async () => {
    const relogio = new RelogioFixo(INICIO);
    const { log, linhas } = logGravador();
    const a = agendaMemoria([
      { tenant_id: T1, tarefa: 'envio', chave: 'cliente' },
      { tenant_id: T1, tarefa: 'envio', chave: 'produto' },
      { tenant_id: T2, tarefa: 'envio', chave: 'filial' },
    ]);
    const posses: number[] = [];
    a.agenda.executar = async (item, ctx) => {
      posses.push(ctx.posseAte.getTime());
      a.vistos.push(item.chave ?? '');
      relogio.avancar(50_000); // 0 s → 50 s → 100 s: o terceiro começaria depois de posseAte − 30 s (90 s)
    };
    const r = await rodarAgendas([a.agenda], { banco: new BancoMemoria(), licencas: licencas([T1, T2]), hub, decifrarCredencial, relogio, log });
    expect(r).toEqual({ executados: 2, falhas: 0, semLicenca: 0 });
    expect(a.vistos).toEqual(['cliente', 'produto']);
    expect(posses).toEqual([INICIO.getTime() + POSSE_AGENDA_MS, INICIO.getTime() + POSSE_AGENDA_MS]);
    expect(linhas.filter((l) => l.devolvidos).map(({ agenda, devolvidos }) => ({ agenda, devolvidos }))).toEqual([{ agenda: 'integracao-fdv.teste', devolvidos: 1 }]);
  });

  it('v0.3.18 (integração A2): cada item recebe ctx.log filho com agenda, tarefa e tenant_id', async () => {
    const { log, linhas } = logGravador();
    const a = agendaMemoria([{ tenant_id: T1, tarefa: 'envio', chave: 'cliente' }]);
    a.agenda.executar = async (_item, ctx) => {
      ctx.log?.warn({ entidade: 'cliente', motivo: 'credencial' }, 'cadastro pausado');
    };
    await rodarAgendas([a.agenda], { banco: new BancoMemoria(), licencas: licencas([T1]), hub, decifrarCredencial, relogio: new RelogioFixo(INICIO), log });
    expect(linhas.filter((l) => l.msg === 'cadastro pausado')).toEqual([
      expect.objectContaining({ agenda: 'integracao-fdv.teste', tarefa: 'envio', tenant_id: T1, entidade: 'cliente', motivo: 'credencial', level: 40 }),
    ]);
  });

  it('tenant sem licença do módulo: semLicenca na transação dele, sem executar', async () => {
    const a = agendaMemoria([
      { tenant_id: T1, tarefa: 'envio', chave: 'cliente' },
      { tenant_id: T2, tarefa: 'envio', chave: 'cliente' },
    ]);
    const r = await rodarAgendas([a.agenda], { banco: new BancoMemoria(), licencas: licencas([T1]), hub, decifrarCredencial, relogio: new RelogioFixo(INICIO), log: pino({ level: 'silent' }) });
    expect(r).toEqual({ executados: 1, falhas: 0, semLicenca: 1 });
    expect(a.vistos).toEqual([`executar:envio:cliente:${T1}:true`, `semLicenca:envio:${T2}`]);
  });

  it('erro no executar não derruba o laço nem a outra agenda; o log leva só o nome do erro', async () => {
    const { log, linhas } = logGravador();
    const a = agendaMemoria(
      [
        { tenant_id: T1, tarefa: 'envio', chave: 'cliente' },
        { tenant_id: T2, tarefa: 'envio', chave: 'cliente' },
      ],
      async (i) => {
        if (i.tenant_id === T1) throw new TypeError('cliente Fulano CPF 52998224725');
      },
    );
    const quebrada: AgendaModulo = { ...agendaMemoria([]).agenda, id: 'integracao-fdv.quebrada', reservar: async () => { throw new Error('banco fora 52998224725'); } };
    const b = agendaMemoria([{ tenant_id: T2, tarefa: 'sinal', chave: null }]);
    const r = await rodarAgendas([a.agenda, quebrada, b.agenda], { banco: new BancoMemoria(), licencas: licencas([T1, T2]), hub, decifrarCredencial, relogio: new RelogioFixo(INICIO), log });
    expect(r).toEqual({ executados: 2, falhas: 1, semLicenca: 0 });
    expect(b.vistos).toEqual([`executar:sinal:null:${T2}:true`]);
    const erros = linhas.filter((l) => l.erro);
    expect(erros.map(({ agenda, tarefa, tenant_id, erro }) => ({ agenda, tarefa, tenant_id, erro }))).toEqual([
      { agenda: 'integracao-fdv.teste', tarefa: 'envio', tenant_id: T1, erro: 'TypeError' },
      { agenda: 'integracao-fdv.quebrada', tarefa: undefined, tenant_id: undefined, erro: 'Error' },
    ]);
    expect(JSON.stringify(linhas)).not.toContain('52998224725');
  });

  it('o ciclo do worker roda as agendas só quando ligadas', async () => {
    const banco = new BancoMemoria();
    const base = {
      banco,
      outbox: new FilaOutboxMemoria(),
      trabalhos: new ReservaTrabalhosMemoria(),
      consumo: new RegistroConsumoMemoria(),
      consumidores: [],
      executores: [],
      relogio: new RelogioFixo(INICIO),
      log: pino({ level: 'silent' }),
    };
    const a = agendaMemoria([{ tenant_id: T1, tarefa: 'sinal', chave: null }]);
    // desligado (sem `agenda`): nem reserva
    expect(await ciclo(base)).toBe(false);
    expect(a.reservas).toEqual([]);
    expect(await ciclo({ ...base, agenda: { agendas: [a.agenda], licencas: licencas([T1]), hub, decifrarCredencial } })).toBe(true);
    expect(a.vistos).toHaveLength(1);
    expect(await ciclo({ ...base, agenda: { agendas: [a.agenda], licencas: licencas([T1]), hub, decifrarCredencial } })).toBe(false);
  });
});

describe('decifrarCredencial no laço', () => {
  const CHAVE_CONECTOR = 'mfdv_SEGREDO-do-conector-0123456789abcdef';

  it('versão 1 abre a chave do conector no executar; versão 2 e outro tenant falham com erro fixo; a chave nunca vai ao log', async () => {
    const { log, linhas } = logGravador();
    const cifradas: Record<string, Uint8Array> = { [T1]: cifrarCampo({ chave: CHAVE_MESTRA, tenantId: T1, claro: CHAVE_CONECTOR }), [T2]: cifrarCampo({ chave: CHAVE_MESTRA, tenantId: T1, claro: CHAVE_CONECTOR }) };
    const usadas: string[] = [];
    const credenciais: string[] = [];
    const hubGravador: ClienteHub = {
      chamar: async (cred) => {
        credenciais.push(cred.chave);
        return { tipo: 'ok', status: 200, corpo: null, replay: false };
      },
    };
    const a = agendaMemoria([
      { tenant_id: T1, tarefa: 'sinal', chave: '1' },
      { tenant_id: T1, tarefa: 'sinal', chave: '2' },
      // cifrado de T1 guardado em T2: o AAD não confere
      { tenant_id: T2, tarefa: 'sinal', chave: '1' },
    ]);
    a.agenda.executar = async (item, ctx) => {
      const chave = ctx.decifrarCredencial(cifradas[item.tenant_id]!, item.tenant_id, Number(item.chave));
      usadas.push(`${item.tenant_id}:${item.chave}`);
      await ctx.hub.chamar({ conectorId: 'conector-1', chave, ambiente: 'teste' }, { metodo: 'POST', caminho: '/sinal', corpo: {} });
    };
    const r = await rodarAgendas([a.agenda], { banco: new BancoMemoria(), licencas: licencas([T1, T2]), hub: hubGravador, decifrarCredencial, relogio: new RelogioFixo(INICIO), log });
    expect(r).toEqual({ executados: 1, falhas: 2, semLicenca: 0 });
    expect(usadas).toEqual([`${T1}:1`]);
    expect(credenciais).toEqual([CHAVE_CONECTOR]);
    expect(linhas.filter((l) => l.erro).map((l) => l.erro)).toEqual(['ErroCifra', 'ErroCifra']);
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain(CHAVE_CONECTOR);
    expect(tudo).not.toContain(CHAVE_MESTRA.toString('hex'));
    expect(tudo).not.toContain(CHAVE_MESTRA.toString('base64'));
  });
});

describe('registrarAgendas', () => {
  const agenda = (id: string, modulo: AgendaModulo['modulo'] = 'integracao-fdv'): AgendaModulo => ({ ...agendaMemoria([]).agenda, id, modulo });

  it('aceita <modulo>.<agenda> do próprio módulo e congela', () => {
    const r = registrarAgendas([agenda('integracao-fdv.envio'), agenda('integracao-fdv.sinal'), agenda('integracao-fdv.busca-pedidos')]);
    expect(r.map((a) => a.id)).toEqual(['integracao-fdv.envio', 'integracao-fdv.sinal', 'integracao-fdv.busca-pedidos']);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('recusa id fora do padrão, de outro módulo ou duplicado', () => {
    expect(() => registrarAgendas([agenda('envio')])).toThrow(/fora de/);
    expect(() => registrarAgendas([agenda('integracao-fdv.Envio')])).toThrow(/fora de/);
    expect(() => registrarAgendas([agenda('integracao-fdv.-envio')])).toThrow(/fora de/);
    expect(() => registrarAgendas([agenda('integracao-fdv.envio pedidos')])).toThrow(/fora de/);
    expect(() => registrarAgendas([agenda('cadastros.envio')])).toThrow(/fora de/);
    expect(() => registrarAgendas([agenda('integracao-fdv.envio'), agenda('integracao-fdv.envio')])).toThrow(/duas agendas/);
  });
});
