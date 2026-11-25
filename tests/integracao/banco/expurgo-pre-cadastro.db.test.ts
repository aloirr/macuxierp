/**
 * T-0098 (plano da v0.3.13, V-1, V-5 e a ponta da rota), RN-INF-06 com a emenda e a decisão do gerente de 24/11/2026, 23h30
 * (Manaus): o pré-cadastro sem decisão (`recebido` ou `reenviado`, a última revisão) só é expurgado quando o
 * `recebido_em` do FDV **e** o `chegou_em` do ERP são anteriores ao corte, com a mesma comparação do recusado (`<`).
 * Aqui ficam o limite exato do corte (1 s antes, igual, 1 s depois), cada data sozinha, a rota do BKO depois do expurgo e
 * a rotina diária real do worker (`criarRotinaExpurgoPreCadastro`, corte de 180 dias mais 5 min de folga, log só com contagens).
 * Contagens, auditoria, RLS, reexecução e CHECKs: db/testes/pre-cadastro-0062.db.test.ts (banco-dados).
 * A API de produção sobre o PostgreSQL efêmero (`montarApiPg`); a função roda no papel do worker. Sem Postgres pula.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMINHOS_INTEGRACAO_FDV_TENANT, PaginaClientesRecebidosFdv } from '../../../packages/platform-sdk/src/index';
import type { BancoPg } from '../../../packages/platform-sdk/src/pg';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { criarRotinaExpurgoPreCadastro } from '../../../apps/worker/src/expurgo-pre-cadastro';
import { montarApiPg } from '../../apoio/api-pg';

const RAZAO = 'Mercadinho Ficticio do Expurgo';
const DOCUMENTO = '11444777000161';
type Situacao = 'recebido' | 'reenviado';

describe.skipIf(!PG_DISPONIVEL)('T-0098 — expurgo do pré-cadastro sem decisão: limite do corte e rota do BKO', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'A' | 'R'>>>;
  let worker: BancoPg;
  /** Corte válido (mais de 180 dias atrás), em ms, lido do relógio do banco. */
  let corte = 0;

  /**
   * Uma revisão sem decisão com as duas datas relativas a `base` (padrão: o corte); o reenviado leva a revisão 1
   * recusada antes. `quem`: o tenant (o R é só da rotina do worker, V-5).
   */
  const inserir = async (situacao: Situacao, recebido: number, chegou: number, o: { quem?: 'A' | 'R'; base?: number } = {}) => {
    const em = (deltaMs: number) => new Date((o.base ?? corte) + deltaMs).toISOString();
    const uuid = randomUUID();
    const sql = (rev: number, s: string, r: string, c: string) =>
      api.b.admin.query(
        `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social,
           documento_mascarado, payload, recebido_em, chegou_em, situacao, motivo, erros, decidido_em, ultima_recusa_em)
         VALUES ($1, $2, $3, repeat('b', 64), '54321', $4, '11.444.777/****-**', jsonb_build_object('documento', $5::text),
           $6, $7, $8,
           CASE WHEN $8 = 'recusado' THEN 'Documento inválido.' END,
           CASE WHEN $8 = 'recusado' THEN '[{"campo":"documento","codigo":"documento_invalido","mensagem":"Documento inválido."}]'::jsonb END,
           CASE WHEN $8 = 'recusado' THEN now() END, CASE WHEN $8 = 'recusado' THEN now() END)`,
        [api.t[o.quem ?? 'A'], uuid, rev, RAZAO, DOCUMENTO, r, c, s],
      );
    // a revisão 1 recusada é recente: não entra no expurgo do recusado e não atrapalha o limite da revisão 2
    if (situacao === 'reenviado') await sql(1, 'recusado', em(-86_400_000), em(-86_400_000));
    await sql(situacao === 'reenviado' ? 2 : 1, situacao, em(recebido), em(chegou));
    return uuid;
  };
  const expurgado = async (uuid: string) =>
    (
      await api.b.admin.query<{ x: boolean }>(
        'SELECT payload_expurgado_em IS NOT NULL AS x FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = $1 ORDER BY revisao DESC LIMIT 1',
        [uuid],
      )
    ).rows[0]!.x;

  beforeAll(async () => {
    api = await montarApiPg({ A: ['integracao-fdv'], R: ['integracao-fdv'] });
    worker = api.b.banco('macuxierp_worker');
    corte = (await api.b.admin.query<{ c: Date }>("SELECT now() - interval '181 days' AS c")).rows[0]!.c.getTime();
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('V-1: 1 s antes do corte nas duas datas expurga; no corte exato ou 1 s depois, fica; vale para recebido e reenviado', async () => {
    const casos: [Situacao, number, number, boolean][] = [];
    for (const s of ['recebido', 'reenviado'] as const) {
      casos.push(
        [s, -1000, -1000, true],
        [s, 0, 0, false],
        [s, 1000, 1000, false],
        // cada data sozinha no limite: as duas precisam estar antes do corte (decisão do gerente, 23h30)
        [s, -1000, 0, false],
        [s, 0, -1000, false],
        // recebido no FDV muito antes, mas chegou ao ERP depois do corte: não expurga
        [s, -10 * 86_400_000, 10 * 86_400_000, false],
      );
    }
    const uuids = [];
    for (const [s, r, c] of casos) uuids.push(await inserir(s, r, c));
    const r = await worker.comTenant(api.t.A, (tx) =>
      tx.consultar<{ r: { sem_decisao: { revisoes: number } } }>('SELECT integracao_fdv.expurgar_pre_cadastro($1) AS r', [new Date(corte)]),
    );
    expect(r[0]!.r.sem_decisao.revisoes).toBe(2);
    for (const [i, [s, rec, che, esperado]] of casos.entries()) expect(await expurgado(uuids[i]!), `${s} recebido ${rec} ms, chegou ${che} ms`).toBe(esperado);
  });

  it('a rota do BKO mostra o expurgado sem decisão com "—", sem documento, no contrato, e não leva o payload', async () => {
    const res = await api.chamar('A', 'GET', `/v1${CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos}`);
    expect(res.statusCode, res.body).toBe(200);
    const itens = PaginaClientesRecebidosFdv.parse(res.json()).itens;
    const expurgados = itens.filter((i) => i.razao_social === '—');
    expect(expurgados.map((i) => i.situacao).sort()).toEqual(['recebido', 'reenviado']);
    expect(expurgados.every((i) => i.documento_mascarado === null)).toBe(true);
    expect(res.body).not.toContain(DOCUMENTO);
    // os que ficaram seguem com a razão social (tela autorizada; LGPD proíbe em log, não na tela)
    expect(itens.some((i) => i.razao_social === RAZAO)).toBe(true);
  });

  it('V-5: a rotina diária do worker expurga o sem decisão com 180 dias e a folga de 5 min; o log leva só contagens', async () => {
    const agora = Date.now();
    const DIA = 86_400_000;
    const prazo = -180 * DIA;
    const velho = await inserir('recebido', prazo - 6 * 60_000, prazo - 6 * 60_000, { quem: 'R', base: agora });
    const naFolga = await inserir('reenviado', prazo - 60_000, prazo - 60_000, { quem: 'R', base: agora });
    const recente = await inserir('recebido', -10 * DIA, -10 * DIA, { quem: 'R', base: agora });
    const linhas: string[] = [];
    const linha = (obj: Record<string, unknown>, msg: string) => void linhas.push(JSON.stringify([obj, msg]));
    const rotina = criarRotinaExpurgoPreCadastro({ banco: worker, log: { info: linha, warn: linha }, tenantsAtivos: async () => [api.t.R] });
    expect(rotina.id).toBe('integracao-fdv.expurgo-pre-cadastro');
    const resumo = await rotina.executar(new Date(agora));
    expect(resumo).toMatchObject({ tenants: 1, falhas: 0, sem_decisao_revisoes: 1, sem_decisao_pre_cadastros: 1, recusado_revisoes: 0 });
    expect([await expurgado(velho), await expurgado(naFolga), await expurgado(recente)]).toEqual([true, false, false]);
    // de novo no mesmo dia: nada a mais
    expect(await rotina.executar(new Date(agora))).toMatchObject({ sem_decisao_revisoes: 0, falhas: 0 });
    expect(linhas).toHaveLength(1);
    for (const s of [RAZAO, DOCUMENTO, '11.444.777', velho]) expect(linhas.join('\n')).not.toContain(s);
  });
});
