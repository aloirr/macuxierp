/**
 * T-0098 (v0.3.13, migração 0062; RN-INF-06, decisão R-20261124-214227 opção A): o expurgo diário passa a cobrir o
 * pré-cadastro sem decisão (recebido ou reenviado), 180 dias depois da chegada da própria revisão, com o mesmo tratamento
 * do recusado. A expurgar_pre_cadastro_recusado da 0057 saiu na 0066 (expurgo-recusado-drop-0066). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { type BancoDeTeste, consultar, criarBancoDeTeste, executar, falha, PG_DISPONIVEL, permitirSetRole, recusaDetalhada, rodarScript } from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0062_integracao_fdv_expurgo_sem_decisao.sql', import.meta.url));
const A = novoTenant('pre-cadastro-0062-a');
const B = novoTenant('pre-cadastro-0062-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const EXPURGO = 'integracao_fdv.expurgar_pre_cadastro(timestamptz)';
const CORTE = `now() - interval '180 days'`;
const ERROS = '[{"campo": "documento", "codigo": "documento_invalido", "mensagem": "Documento inválido."}]';
const dias = (n: number): string => `now() - interval '${n} days'`;

interface Rev {
  uuid: string;
  revisao?: number;
  situacao?: 'recebido' | 'reenviado' | 'recusado' | 'aceito';
  /** Dias atrás do recebido_em do FDV. */
  recebido: number;
  /** Dias atrás da chegada no ERP (padrão: o recebido). */
  chegou?: number;
  /** Dias atrás da recusa (recusado) ou da decisão (aceito). */
  decidido?: number;
}

/** INSERT do worker de uma revisão do pré-cadastro. */
const rev = (t: string, p: Rev): string => {
  const s = p.situacao ?? 'recebido';
  const decidido = s === 'aceito' || s === 'recusado' ? dias(p.decidido ?? 0) : 'NULL';
  return `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social,
    documento_mascarado, payload, recebido_em, chegou_em, situacao, motivo, erros, cliente_id, decidido_em, ultima_recusa_em)
  VALUES ('${t}', '${p.uuid}', ${p.revisao ?? 1}, repeat('a', 64), '12345', 'Mercadinho Ficticio', '11.444.777/****-**',
    ${s === 'aceito' ? 'NULL' : `'{"razao_social": "Mercadinho Ficticio"}'`}, ${dias(p.recebido)}, ${dias(p.chegou ?? p.recebido)},
    '${s}', ${s === 'recusado' ? `'Documento inválido.'` : 'NULL'}, ${s === 'recusado' ? `'${ERROS}'` : 'NULL'},
    ${s === 'aceito' ? 'gen_random_uuid()' : 'NULL'}, ${decidido}, ${s === 'recusado' ? decidido : 'NULL'});`;
};

let banco: BancoDeTeste;
const um = <T,>(sql: string, ctx?: Parameters<typeof consultar>[2]): T => consultar<T>(banco.conexao, sql, ctx)[0] as T;
const expurgar = (ctx: typeof WORKER_A): unknown => um<{ r: unknown }>(`SELECT integracao_fdv.expurgar_pre_cadastro(${CORTE}) AS r`, ctx).r;
const retrato = (u: string, ctx = WORKER_A): unknown =>
  consultar(
    banco.conexao,
    `SELECT revisao, situacao, payload IS NOT NULL AS payload, razao_social IS NOT NULL AS razao,
       documento_mascarado IS NOT NULL AS doc, payload_expurgado_em IS NOT NULL AS expurgado, codigo_fdv, hash, tentativas_fdv
     FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}' ORDER BY revisao`,
    ctx,
  );
const auditorias = (t: string): unknown[] =>
  consultar(
    banco.conexao,
    `SELECT acao, entidade, entidade_id, usuario_id, antes, depois FROM plataforma.auditoria
      WHERE tenant_id = '${t}' AND acao = 'integracao-fdv.pre-cadastro.expurgar' ORDER BY ocorrido_em`,
  );
const zero = { revisoes: 0, pre_cadastros: 0 };

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — expurgo do pré-cadastro sem decisão (T-0098, 0062)', () => {
  const semVelho = randomUUID(); // recebido há 200 dias: sai
  const semRecente = randomUUID(); // recebido há 10 dias: fica
  const chegouAgora = randomUUID(); // recebido no FDV há 200 dias, chegou ao ERP há 10: fica
  const reenvVelho = randomUUID(); // rev 1 recusada há 250, rev 2 reenviada há 200: saem as duas
  const reenvNovo = randomUUID(); // rev 1 recusada há 250, rev 2 reenviada há 10: sai só a rev 1
  const recusado = randomUUID(); // recusado há 200 dias: sai (regra da 0057)
  const aceito = randomUUID(); // aceito há 200 dias: não é tocado
  const deB = randomUUID(); // tenant B, recebido há 200 dias: só o worker de B expurga

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureIntegracao(t)).join('\n'));
    executar(
      banco.conexao,
      [
        rev(A.id, { uuid: semVelho, recebido: 200 }),
        rev(A.id, { uuid: semRecente, recebido: 10 }),
        rev(A.id, { uuid: chegouAgora, recebido: 200, chegou: 10 }),
        rev(A.id, { uuid: reenvVelho, situacao: 'recusado', recebido: 300, decidido: 250 }),
        rev(A.id, { uuid: reenvVelho, revisao: 2, situacao: 'reenviado', recebido: 200 }),
        rev(A.id, { uuid: reenvNovo, situacao: 'recusado', recebido: 300, decidido: 250 }),
        rev(A.id, { uuid: reenvNovo, revisao: 2, situacao: 'reenviado', recebido: 10 }),
        rev(A.id, { uuid: recusado, situacao: 'recusado', recebido: 210, decidido: 200 }),
        rev(A.id, { uuid: aceito, situacao: 'aceito', recebido: 210, decidido: 200 }),
      ].join('\n'),
      WORKER_A,
    );
    executar(banco.conexao, rev(B.id, { uuid: deB, recebido: 200 }), WORKER_B);
  });

  afterAll(() => banco?.remover());

  it('estrutura: índice do sem-decisão; a função é SECURITY DEFINER e só o worker executa', () => {
    expect(
      um(`SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'integracao_fdv' AND indexname = 'cliente_recebido_expurgo_sem_decisao_idx'`),
    ).toEqual({
      d: expect.stringContaining(
        "(tenant_id, recebido_em) WHERE ((situacao = ANY (ARRAY['recebido'::text, 'reenviado'::text])) AND (payload IS NOT NULL))",
      ),
    });
    const f = um<Record<string, unknown>>(
      `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg, obj_description(p.oid, 'pg_proc') ~ 'RN-INF-06' AS comentado,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
         has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
         has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura
       FROM pg_proc p WHERE p.oid = '${EXPURGO}'::regprocedure`,
    );
    expect(f).toEqual({ definer: true, cfg: 'search_path=pg_catalog, pg_temp', comentado: true, publico: false, app: false, worker: true, leitura: false });
    expect(falha(() => executar(banco.conexao, `SELECT integracao_fdv.expurgar_pre_cadastro(${CORTE});`, APP_A))).toMatch(/permission denied/);
  });

  it('recusa corte antes de 180 dias ou nulo (23514) e sessão sem tenant (42501)', () => {
    for (const corte of [dias(179), 'NULL']) {
      recusaDetalhada(banco.conexao, `SELECT integracao_fdv.expurgar_pre_cadastro(${corte});`, '23514', /180 dias/, WORKER_A);
    }
    recusaDetalhada(banco.conexao, `SELECT integracao_fdv.expurgar_pre_cadastro(${CORTE});`, '42501', /sem tenant/, {
      papel: 'macuxierp_worker',
      tenant: null,
    });
    expect(auditorias(A.id)).toEqual([]);
  });

  it('expurga o sem-decisão e o recusado com mais de 180 dias; o recente, o aceito e o de outro tenant não mudam', () => {
    const intactos = (): unknown => ({
      semRecente: retrato(semRecente),
      chegouAgora: retrato(chegouAgora),
      aceito: retrato(aceito),
      deB: retrato(deB, WORKER_B),
    });
    const antes = intactos();
    const antesSem = retrato(semVelho) as Record<string, unknown>[];
    expect(expurgar(WORKER_A)).toEqual({ recusado: { revisoes: 3, pre_cadastros: 3 }, sem_decisao: { revisoes: 2, pre_cadastros: 2 } });
    // mesmo tratamento do recusado: some payload, razão social e documento; ficam os códigos, a situação e as contagens
    expect(retrato(semVelho)).toEqual([{ ...antesSem[0], payload: false, razao: false, doc: false, expurgado: true }]);
    expect(retrato(semVelho)).toMatchObject([{ situacao: 'recebido', codigo_fdv: '12345', hash: 'a'.repeat(64), tentativas_fdv: 1 }]);
    expect(retrato(recusado)).toMatchObject([{ situacao: 'recusado', payload: false, expurgado: true }]);
    // o reenviado conta da própria revisão (a última), não da primeira
    expect(retrato(reenvVelho)).toMatchObject([
      { revisao: 1, situacao: 'recusado', payload: false, expurgado: true },
      { revisao: 2, situacao: 'reenviado', payload: false, razao: false, doc: false, expurgado: true },
    ]);
    expect(retrato(reenvNovo)).toMatchObject([
      { revisao: 1, situacao: 'recusado', payload: false, expurgado: true },
      { revisao: 2, situacao: 'reenviado', payload: true, razao: true, doc: true, expurgado: false },
    ]);
    expect(intactos()).toEqual(antes);
    // a auditoria leva só as contagens, separadas por situação
    expect(auditorias(A.id)).toEqual([
      {
        acao: 'integracao-fdv.pre-cadastro.expurgar',
        entidade: 'cliente_recebido',
        entidade_id: null,
        usuario_id: null,
        antes: null,
        depois: { regra: 'RN-INF-06', recusado: { revisoes: 3, pre_cadastros: 3 }, sem_decisao: { revisoes: 2, pre_cadastros: 2 } },
      },
    ]);
    expect(auditorias(B.id)).toEqual([]);
  });

  it('é idempotente: rodar de novo não expurga nada nem audita; o worker de B expurga só o B', () => {
    const antes = retrato(semRecente);
    expect(expurgar(WORKER_A)).toEqual({ recusado: zero, sem_decisao: zero });
    expect(auditorias(A.id)).toHaveLength(1);
    expect(expurgar(WORKER_B)).toEqual({ recusado: zero, sem_decisao: { revisoes: 1, pre_cadastros: 1 } });
    expect(retrato(deB, WORKER_B)).toMatchObject([{ payload: false, expurgado: true }]);
    expect(retrato(semRecente)).toEqual(antes);
  });

  it('CHECKs: o sem-decisão só fica sem payload pelo expurgo; o expurgado ainda pode ser decidido', () => {
    expect(
      falha(() => executar(banco.conexao, `UPDATE integracao_fdv.cliente_recebido SET payload = NULL WHERE cliente_uuid = '${semRecente}';`, WORKER_A)),
    ).toMatch(/cliente_recebido_payload/);
    // o FDV entrega de novo a revisão expurgada e o worker decide (aceito ou recusado)
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cliente_recebido SET situacao = 'aceito', cliente_id = gen_random_uuid(), decidido_em = now()
        WHERE cliente_uuid = '${semVelho}';
       UPDATE integracao_fdv.cliente_recebido SET situacao = 'recusado', motivo = 'Documento inválido.', erros = '${ERROS}',
         decidido_em = now(), ultima_recusa_em = now() WHERE cliente_uuid = '${reenvVelho}' AND revisao = 2;`,
      WORKER_A,
    );
    expect(retrato(semVelho)).toMatchObject([{ situacao: 'aceito', payload: false, expurgado: true }]);
    expect(retrato(reenvVelho)).toMatchObject([{ revisao: 1 }, { revisao: 2, situacao: 'recusado', payload: false, expurgado: true }]);
  });

  it('a 0062 é reexecutável: rodar de novo não muda dado, índice, CHECK nem privilégio', () => {
    const r = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM integracao_fdv.cliente_recebido c) AS recebidos,
                (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'integracao_fdv') AS ix,
                (SELECT string_agg(pg_get_constraintdef(oid), ' | ' ORDER BY conname) FROM pg_constraint
                  WHERE conrelid = 'integracao_fdv.cliente_recebido'::regclass) AS ck,
                (SELECT proacl::text FROM pg_proc WHERE oid = '${EXPURGO}'::regprocedure) AS acl`,
      );
    const antes = r();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(r()).toEqual(antes);
  });
});
