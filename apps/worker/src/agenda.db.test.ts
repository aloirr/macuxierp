/**
 * Laço de agenda no PostgreSQL migrado (contrato C-9, T-0009 §6.1), com o papel `macuxierp_worker` (RLS valendo).
 * A agenda de teste abaixo (SQL sobre `integracao_fdv.cursor_entidade`) existe só neste arquivo: a de verdade é do
 * módulo `integracao-fdv`. O Hub é um `fetch` dublê. Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { criarClienteHub, type AgendaModulo, type ItemAgenda, type Transacao } from '@macuxierp/platform-sdk';
import { LicencasPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rodarAgendas } from './agenda';
import { criarDecifradorCredencial } from './credencial';

const log = pino({ level: 'silent' });
const decifrarCredencial = criarDecifradorCredencial(new Map([[1, randomBytes(32)]]));

const RESERVAR = `
  WITH vencidos AS (
    SELECT id FROM integracao_fdv.cursor_entidade
    WHERE pausada_motivo IS NULL AND deleted_at IS NULL AND proximo_em <= $2
    ORDER BY proximo_em, id
    LIMIT $1
    FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE integracao_fdv.cursor_entidade c SET proximo_em = $3, updated_at = $2
  FROM vencidos v WHERE c.id = v.id
  RETURNING c.tenant_id, c.entidade AS chave, c.proximo_em`;

/** Agenda de teste: um item por `cursor_entidade` vencido; o executar chama `POST /sinal` e regrava o proximo_em. */
function agendaTeste(vistos: string[]): AgendaModulo {
  return {
    id: 'integracao-fdv.teste',
    modulo: 'integracao-fdv',
    async reservar(tx: Transacao, limite: number, agora: Date, posseAte: Date): Promise<ItemAgenda[]> {
      const linhas = await tx.consultar<{ tenant_id: string; chave: string }>(RESERVAR, [limite, agora, posseAte]);
      return linhas.map((l) => ({ tenant_id: l.tenant_id, tarefa: 'envio', chave: l.chave }));
    },
    async executar(item, ctx) {
      const r = await ctx.hub.chamar({ conectorId: 'conector-teste', chave: 'chave-de-teste', ambiente: 'teste' }, { metodo: 'POST', caminho: '/sinal', corpo: { versao_contrato: 'v1' } });
      await ctx.emTransacao(async (tx) => {
        const [t] = await tx.consultar<{ t: string }>("SELECT current_setting('app.tenant_id') AS t");
        vistos.push(`${item.chave}:${t?.t === item.tenant_id}:${r.tipo}`);
        await tx.consultar('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $3, ultimo_envio_em = $2 WHERE tenant_id = $1 AND entidade = $4', [
          item.tenant_id,
          ctx.agora,
          new Date(ctx.agora.getTime() + 60_000),
          item.chave,
        ]);
      });
    },
    async semLicenca(item, tx, agora) {
      await tx.consultar("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'licenca_erp', pausada_em = $3 WHERE tenant_id = $1 AND entidade = $2", [item.tenant_id, item.chave, agora]);
    },
  };
}

describe.skipIf(!PG_DISPONIVEL)('laço de agenda no PostgreSQL (papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let worker: BancoPg;
  let t1: string;
  let t2: string;
  let relogio: RelogioFixo;
  const chamadas: string[] = [];
  const hub = criarClienteHub({
    urls: { teste: 'https://hub-teste.exemplo.com.br', producao: 'https://hub.exemplo.com.br' },
    versaoErp: '0.1.0',
    fetch: (async (u: URL | string) => {
      chamadas.push(String(u));
      return new Response('{"aceito":true}', { status: 200 });
    }) as typeof fetch,
  });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    t1 = await criarTenant(b.admin, 'agenda-um', ['integracao-fdv']);
    t2 = await criarTenant(b.admin, 'agenda-dois', ['integracao-fdv']);
  });
  afterAll(async () => {
    await b?.remover();
  });
  beforeEach(async () => {
    relogio = new RelogioFixo(new Date());
    chamadas.length = 0;
    await b.admin.query('TRUNCATE integracao_fdv.cursor_entidade');
  });

  /** Linha da agenda gravada pelo admin, vencida `atrasoMs` antes do relógio do teste. */
  async function cursor(tenant: string, entidade: string, atrasoMs = 1_000, pausada = false) {
    await b.admin.query(
      `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em, pausada_motivo, pausada_em)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant, entidade, new Date(relogio.agora().getTime() - atrasoMs), pausada ? 'credencial' : null, pausada ? relogio.agora() : null],
    );
  }

  const proximos = async () =>
    (await b.admin.query<{ entidade: string; proximo_em: Date }>('SELECT entidade, proximo_em FROM integracao_fdv.cursor_entidade ORDER BY entidade')).rows;

  it('semTenant enxerga os dois tenants, adia proximo_em para a posse na mesma transação e pula a linha pausada', async () => {
    await cursor(t1, 'cliente', 3_000);
    await cursor(t2, 'produto', 2_000);
    await cursor(t1, 'filial', 1_000, true);
    await cursor(t2, 'vendedor', -60_000); // ainda não venceu
    const agora = relogio.agora();
    const posse = new Date(agora.getTime() + 120_000);
    const dentro = await worker.semTenant(async (tx) => {
      const itens = await agendaTeste([]).reservar(tx, 10, agora, posse);
      const [l] = await tx.consultar<{ n: number }>('SELECT count(*)::int AS n FROM integracao_fdv.cursor_entidade WHERE proximo_em = $1', [posse]);
      return { itens, adiados: l?.n };
    });
    expect(dentro.itens).toEqual([
      { tenant_id: t1, tarefa: 'envio', chave: 'cliente' },
      { tenant_id: t2, tarefa: 'envio', chave: 'produto' },
    ]);
    expect(dentro.adiados).toBe(2);
    const depois = Object.fromEntries((await proximos()).map((l) => [l.entidade, l.proximo_em.getTime()]));
    expect(depois.cliente).toBe(posse.getTime());
    expect(depois.produto).toBe(posse.getTime());
    // a posse segura o item: nova reserva no mesmo instante não pega nada
    expect(await worker.semTenant((tx) => agendaTeste([]).reservar(tx, 10, agora, posse))).toEqual([]);
  });

  it('controle negativo: macuxierp_app em semTenant não vê cursor_entidade (a visão global é da política worker_global)', async () => {
    await cursor(t1, 'cliente', 3_000);
    await cursor(t2, 'produto', 2_000);
    const app = b.banco('macuxierp_app');
    expect(await app.semTenant((tx) => tx.consultar('SELECT tenant_id FROM integracao_fdv.cursor_entidade'))).toEqual([]);
    const [w] = await worker.semTenant((tx) => tx.consultar<{ n: number }>('SELECT count(*)::int AS n FROM integracao_fdv.cursor_entidade'));
    expect(w?.n).toBe(2);
  });

  it('posse vencida: reservar com agora depois do posseAte devolve o item de novo', async () => {
    await cursor(t1, 'cliente', 1_000);
    const agora = relogio.agora();
    const posse = new Date(agora.getTime() + 120_000);
    const a = agendaTeste([]);
    expect(await worker.semTenant((tx) => a.reservar(tx, 10, agora, posse))).toHaveLength(1);
    expect(await worker.semTenant((tx) => a.reservar(tx, 10, new Date(posse.getTime() - 1), posse))).toEqual([]);
    const depois = new Date(posse.getTime() + 1);
    expect(await worker.semTenant((tx) => a.reservar(tx, 10, depois, new Date(depois.getTime() + 120_000)))).toEqual([{ tenant_id: t1, tarefa: 'envio', chave: 'cliente' }]);
  });

  it('executar que lança erro deixa o item preso na posse até ela vencer', async () => {
    await cursor(t1, 'cliente', 1_000);
    const quebrada: AgendaModulo = {
      ...agendaTeste([]),
      async executar() {
        throw new Error('falha no meio');
      },
    };
    expect(await rodarAgendas([quebrada], { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log })).toEqual({ executados: 0, falhas: 1, semLicenca: 0 });
    const posse = relogio.agora().getTime() + 120_000;
    expect((await proximos()).map((l) => l.proximo_em.getTime())).toEqual([posse]);
    // ainda na posse: a rodada seguinte não pega o item
    relogio.avancar(119_000);
    expect(await rodarAgendas([agendaTeste([])], { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log })).toEqual({ executados: 0, falhas: 0, semLicenca: 0 });
    // posse vencida: volta e executa
    relogio.avancar(1_000);
    const vistos: string[] = [];
    expect(await rodarAgendas([agendaTeste(vistos)], { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log })).toEqual({ executados: 1, falhas: 0, semLicenca: 0 });
    expect(vistos).toEqual(['cliente:true:ok']);
  });

  it('SKIP LOCKED: duas reservas concorrentes não pegam o mesmo item', async () => {
    await cursor(t1, 'cliente', 3_000);
    await cursor(t1, 'produto', 2_000);
    await cursor(t2, 'cliente', 1_000);
    const agora = relogio.agora();
    const posse = new Date(agora.getTime() + 120_000);
    const a = agendaTeste([]);
    let segunda: ItemAgenda[] = [];
    const primeira = await worker.semTenant(async (tx) => {
      const itens = await a.reservar(tx, 1, agora, posse);
      // a primeira transação segue aberta, com a linha travada
      segunda = await worker.semTenant((tx2) => a.reservar(tx2, 10, agora, posse));
      return itens;
    });
    expect(primeira).toEqual([{ tenant_id: t1, tarefa: 'envio', chave: 'cliente' }]);
    expect(segunda.map((i) => `${i.tenant_id}:${i.chave}`).sort()).toEqual([`${t1}:produto`, `${t2}:cliente`].sort());
  });

  it('rodarAgendas: executa no tenant certo com o Hub dublê, regrava proximo_em e pausa quem não tem licença', async () => {
    const t3 = await criarTenant(b.admin, `agenda-sem-${randomUUID().slice(0, 8)}`); // sem a licença do integracao-fdv
    await cursor(t1, 'cliente', 2_000);
    await cursor(t2, 'produto', 1_000);
    await cursor(t3, 'vendedor', 500);
    const vistos: string[] = [];
    const r = await rodarAgendas([agendaTeste(vistos)], { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log });
    expect(r).toEqual({ executados: 2, falhas: 0, semLicenca: 1 });
    expect(vistos).toEqual(['cliente:true:ok', 'produto:true:ok']);
    expect(chamadas).toEqual(['https://hub-teste.exemplo.com.br/integracao/v1/sinal', 'https://hub-teste.exemplo.com.br/integracao/v1/sinal']);
    const linhas = (
      await b.admin.query<{ entidade: string; proximo_em: Date; pausada_motivo: string | null }>(
        'SELECT entidade, proximo_em, pausada_motivo FROM integracao_fdv.cursor_entidade ORDER BY entidade',
      )
    ).rows;
    const fim = relogio.agora().getTime() + 60_000;
    expect(linhas.map((l) => [l.entidade, l.pausada_motivo, l.entidade === 'vendedor' ? null : l.proximo_em.getTime()])).toEqual([
      ['cliente', null, fim],
      ['produto', null, fim],
      ['vendedor', 'licenca_erp', null],
    ]);
    // nada vencido: a rodada seguinte não faz nada (a pausada não sai)
    expect(await rodarAgendas([agendaTeste(vistos)], { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial, relogio, log })).toEqual({ executados: 0, falhas: 0, semLicenca: 0 });
  });
});
