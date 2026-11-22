/**
 * Rotina `sefaz_simulador.purga` (T-0045 §9) montada como no `main.ts` (`montarRotinas`), no PostgreSQL migrado com o papel `macuxierp_worker`
 * (RLS): roda também no tenant ENCERRADO e no SUSPENSO e apagado (LGPD: a retenção vale para quem saiu), apaga só o criado há mais de 400 dias
 * e o de cada tenant fica no tenant dele. A memória do simulador é gravada pelo dono (fora da RLS), com o `created_at` envelhecido.
 * A lista de tenants deste teste é a dos tenants criados aqui; a da produção (`TodosTenantsPg`, função `plataforma.tenants_todos()`) roda no
 * último caso quando a função existe no banco (pedida ao banco-dados); sem ela (42883), o penúltimo confere a rodada pendente.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { randomUUID } from 'node:crypto';
import type { FonteTodosTenants } from '@macuxierp/platform-sdk';
import { TodosTenantsPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarRotinas } from './modulos';
import { pinoEmMemoria } from './apoio-teste';
import { DIA_MS, rodarRotinas } from './rotinas';

const log = pino({ level: 'silent' });
const CNPJ = '11222333000181';
const PROT = '913260000000001';
let recibos = 0;

describe.skipIf(!PG_DISPONIVEL)('purga da memória do simulador (PostgreSQL, papel macuxierp_worker, tenants desativados)', () => {
  let b: BancoEfemero;
  let worker: BancoPg;
  const tenants: Record<'encerrado' | 'suspenso' | 'ativo', string> = { encerrado: '', suspenso: '', ativo: '' };
  const filial = randomUUID();
  const agora = new Date();
  agora.setUTCHours(7, 0, 0, 0);
  const antigo = new Date(agora.getTime() - 401 * DIA_MS);
  const recente = new Date(agora.getTime() - 399 * DIA_MS);

  const contar = async (tabela: string, tenant: string) =>
    Number((await b.admin.query<{ n: string }>(`SELECT count(*) AS n FROM sefaz_simulador.${tabela} WHERE tenant_id = $1`, [tenant])).rows[0]!.n);

  /** Chave de 44 dígitos (só o formato do domínio `ch_nfe`), distinta por número. */
  const chave = (nnf: number) => `1326${CNPJ}55001${String(nnf).padStart(9, '0')}`.padEnd(44, '0');

  async function memoriaDoSimulador(tenant: string): Promise<void> {
    for (const [nnf, criada] of [[1, antigo], [2, recente]] as const) {
      await b.admin.query(
        `INSERT INTO sefaz_simulador.nota (tenant_id, filial_id, modo, ch_nfe, cnpj, serie, nnf, dh_emi, autorizada_em, situacao, n_prot, c_stat, dh_recbto, xml_prot, created_at)
         VALUES ($1, $2, 'normal', $3, $4, 1, $5, $6, $6, 'autorizada', $7, '100', 'x', '<protNFe/>', $6)`,
        [tenant, filial, chave(nnf), CNPJ, nnf, criada, PROT],
      );
      await b.admin.query(
        `INSERT INTO sefaz_simulador.evento (tenant_id, filial_id, modo, ch_nfe, tp_evento, n_seq_evento, n_prot, c_stat, dh_reg_evento, xml_ret, evento_xml, created_at)
         VALUES ($1, $2, 'normal', $3, '110110', 1, $4, '135', 'x', '<retEvento/>', '<evento/>', $5)`,
        [tenant, filial, chave(nnf), PROT, criada],
      );
      await b.admin.query(
        `INSERT INTO sefaz_simulador.inutilizacao (tenant_id, filial_id, modo, cnpj, serie, ano, nnf_ini, nnf_fin, n_prot, created_at)
         VALUES ($1, $2, 'normal', $3, 1, '26', $4, $4, $5, $6)`,
        [tenant, filial, CNPJ, 100 + nnf, PROT, criada],
      );
      await b.admin.query(
        `INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em, created_at) VALUES ($1, $2, 'normal', $3, 'x', $4, $4)`,
        [tenant, filial, `9132600${String(++recibos).padStart(8, '0')}`, criada],
      );
    }
  }

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    for (const k of Object.keys(tenants) as (keyof typeof tenants)[]) {
      tenants[k] = await criarTenant(b.admin, `purga-${k}-${randomUUID().slice(0, 8)}`);
      await memoriaDoSimulador(tenants[k]);
    }
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'encerrado' WHERE id = $1", [tenants.encerrado]);
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso', deleted_at = now() WHERE id = $1", [tenants.suspenso]);
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  const funcaoExiste = async () =>
    Boolean((await b.admin.query<{ f: string | null }>("SELECT to_regprocedure('plataforma.tenants_todos()')::text AS f")).rows[0]?.f);

  const purga = (todosTenants: FonteTodosTenants, l: typeof log = log) => {
    const r = montarRotinas({ banco: worker, log: l, todosTenants }).find((x) => x.id === 'sefaz_simulador.purga');
    expect(r).toBeDefined();
    return r!;
  };

  it('LGPD: apaga o que passou de 400 dias também no tenant encerrado e no suspenso e apagado; o recente fica; a 2ª rodada não apaga nada', async () => {
    const rotina = purga({ todos: async () => [tenants.encerrado, tenants.suspenso] });
    expect(await rotina.executar(agora)).toEqual({ tenants: 2, notas: 2, eventos: 2, inutilizacoes: 2, recibos: 2, falhas: 0 });
    for (const t of [tenants.encerrado, tenants.suspenso]) {
      expect([await contar('nota', t), await contar('evento', t), await contar('inutilizacao', t), await contar('recibo', t)]).toEqual([1, 1, 1, 1]);
    }
    // O tenant fora da lista não foi tocado; rodar de novo não apaga mais nada.
    expect(await contar('nota', tenants.ativo)).toBe(2);
    expect(await rotina.executar(agora)).toEqual({ tenants: 2, notas: 0, eventos: 0, inutilizacoes: 0, recibos: 0, falhas: 0 });
  });

  it('sem a plataforma.tenants_todos() (42883): pendente, um warn só, rotina concluída no dia e nada apagado', async (ctx) => {
    if (await funcaoExiste()) return ctx.skip();
    const { log: l, registros } = pinoEmMemoria();
    const rotina = purga(new TodosTenantsPg(), l);
    const estado = new Map();
    expect(await rodarRotinas([rotina], estado, agora, l)).toBe(1);
    expect(await rodarRotinas([rotina], estado, new Date(agora.getTime() + 15 * 60_000), l)).toBe(0);
    expect(registros().map((r) => [r.level, r.msg])).toEqual([
      [40, 'purga do simulador pendente: falta a função que lista todos os tenants'],
      [30, 'rotina diária concluída'],
    ]);
    expect(registros()[1]).toMatchObject({ tenants: 0, notas: 0, pendente: 1 });
    expect(await contar('nota', tenants.ativo)).toBe(2);
  });

  it('com o adaptador da produção (TodosTenantsPg): a lista traz os desativados e a purga roda neles', async (ctx) => {
    if (!(await funcaoExiste())) return ctx.skip();
    const ids = await worker.semTenant((tx) => new TodosTenantsPg().todos(tx));
    expect(ids).toEqual(expect.arrayContaining(Object.values(tenants)));
    expect((await purga(new TodosTenantsPg()).executar(agora)).falhas).toBe(0);
    expect(await contar('nota', tenants.ativo)).toBe(1);
  });
});
