/**
 * T-0107 (v0.3.16), migração 0069: integracao_fdv.registro_publicado.contrato_enviado (text NOT NULL DEFAULT 'v1',
 * CHECK 'v1'/'v2', de VERSAO_CONTRATO_HUB e VERSAO_CONTRATO_PRAZO_V2 do contracts/hub.ts) e o índice parcial da
 * varredura do prazo_pagamento; e T-0112: prazo com parcelas_dias em texto volta a pendente. Banco até a 0068 com
 * linhas gravadas, depois a 0069. Motivo em docs/banco/README.md (0069). Dados fictícios.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  numeros,
  type PastaDeMigracoes,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0069_integracao_fdv_contrato_enviado.sql', import.meta.url));
const RP = 'integracao_fdv.registro_publicado';
const INDICE = 'registro_publicado_varredura_prazo_idx';
const A = novoTenant('contrato-0069-a');
const B = novoTenant('contrato-0069-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });
const APP = (t: Tenant) => ({ papel: 'macuxierp_app', tenant: t.id });

/**
 * Linhas do espelho gravadas antes da 0069: prazo aceito, prazo recusado firme fora da fila (sem confirmação), prazo
 * pendente, prazo inativo confirmado, cliente aceito e um prazo inativo com payload anulado. T-0112: prazo com parcelas_dias em texto (fora da
 * fila, excluído e já pendente), prazo com a lista de inteiros e cliente com o mesmo campo em texto.
 */
const espelhoSql = (t: Tenant): string => `
INSERT INTO ${RP} (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, ativo,
  pendente, hash_confirmado, confirmado_em) VALUES
  ('${t.id}', 'prazo_pagamento', 'aceito', '{"codigo": "P30"}', repeat('1', 64), now(), now(), true, false, repeat('1', 64), now()),
  ('${t.id}', 'prazo_pagamento', 'recusado', '{"codigo": "P60"}', repeat('2', 64), now(), now(), true, false, NULL, NULL),
  ('${t.id}', 'prazo_pagamento', 'pendente', '{"codigo": "P90"}', repeat('3', 64), now(), now(), true, true, NULL, NULL),
  ('${t.id}', 'cliente', 'cliente', '{"razao_social": "Cliente"}', repeat('4', 64), now(), now(), true, false, repeat('4', 64), now()),
  ('${t.id}', 'prazo_pagamento', 'inativo', '{"codigo": "P120"}', repeat('b', 64), now(), now(), false, false, repeat('b', 64), now()),
  ('${t.id}', 'prazo_pagamento', 'anulado', NULL, repeat('5', 64), now(), now(), false, false, repeat('5', 64), now()),
  ('${t.id}', 'prazo_pagamento', 'texto', '{"parcelas_dias": "28/56"}', repeat('6', 64), now(), now(), true, false, repeat('6', 64), now()),
  ('${t.id}', 'prazo_pagamento', 'texto-pendente', '{"parcelas_dias": "30"}', repeat('7', 64), now(), now(), true, true, NULL, NULL),
  ('${t.id}', 'prazo_pagamento', 'lista', '{"parcelas_dias": [28, 56]}', repeat('8', 64), now(), now(), true, false, repeat('8', 64), now()),
  ('${t.id}', 'cliente', 'cliente-texto', '{"parcelas_dias": "28"}', repeat('9', 64), now(), now(), true, false, repeat('9', 64), now());
INSERT INTO ${RP} (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, ativo,
  pendente, hash_confirmado, confirmado_em, deleted_at)
  VALUES ('${t.id}', 'prazo_pagamento', 'texto-excluido', '{"parcelas_dias": "28/56"}', repeat('a', 64), now(), now(),
    true, false, repeat('a', 64), now(), now());`;

/** Linhas do espelho por registro_external_id, sem a coluna nova (para comparar antes e depois da 0069). */
const RETRATO_SQL = `SELECT tenant_id::text || '/' || registro_external_id AS k, to_jsonb(r) - 'contrato_enviado' AS l FROM ${RP} r`;

/** A consulta da varredura do prazo (inclui os inativos: o delta envia ativo:false), com a versão antiga = diferente de 'v2'. */
const varreduraSql = (t: Tenant): string =>
  `SELECT id FROM ${RP} WHERE tenant_id = '${t.id}' AND entidade = 'prazo_pagamento' AND deleted_at IS NULL
     AND payload IS NOT NULL AND NOT pendente AND contrato_enviado <> 'v2' ORDER BY id FOR UPDATE SKIP LOCKED`;

let banco: BancoDeTeste;
let anteriores: PastaDeMigracoes;
type Linha = Record<string, unknown>;
let retratoAntes: Record<string, Linha>;
const retrato = (): Record<string, Linha> =>
  Object.fromEntries(consultar<{ k: string; l: Linha }>(banco.conexao, RETRATO_SQL).map((x) => [x.k, x.l]));
const um = <T,>(sql: string, ctx?: Parameters<typeof consultar>[2]): T => consultar<T>(banco.conexao, sql, ctx)[0] as T;
const versoes = (t: Tenant): Record<string, string> =>
  Object.fromEntries(
    consultar<{ r: string; v: string }>(
      banco.conexao,
      `SELECT registro_external_id AS r, contrato_enviado AS v FROM ${RP} WHERE tenant_id = '${t.id}' ORDER BY 1`,
    ).map((x) => [x.r, x.v]),
  );
/** UPDATE do worker no prazo aceito do tenant `t`, contando as linhas atingidas. */
const gravar = (t: Tenant, versao: string, ctx = WORKER(t)): number[] =>
  numeros(
    rodarComo(
      banco.conexao,
      `WITH u AS (UPDATE ${RP} SET contrato_enviado = '${versao}', updated_at = now()
         WHERE tenant_id = '${t.id}' AND registro_external_id = 'aceito' RETURNING 1) SELECT count(*) FROM u;`,
      ctx,
    ),
  );

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — contrato_enviado no espelho (T-0107, 0069)', () => {
  let arquivoAntes: string;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0069');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(
      '0069_integracao_fdv_contrato_enviado.sql',
    );
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + espelhoSql(t)).join('\n'));
    arquivoAntes = um<{ f: string }>(`SELECT pg_relation_filenode('${RP}')::text AS f`).f;
    retratoAntes = retrato();
    expect(migrar(banco.conexao, { oficiais: false })).toContain('0069_integracao_fdv_contrato_enviado.sql');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('a coluna é text NOT NULL DEFAULT v1, com o CHECK v1/v2', () => {
    expect(
      um(`SELECT data_type AS tipo, is_nullable AS nula, column_default AS padrao FROM information_schema.columns
           WHERE table_schema = 'integracao_fdv' AND table_name = 'registro_publicado' AND column_name = 'contrato_enviado'`),
    ).toEqual({ tipo: 'text', nula: 'NO', padrao: "'v1'::text" });
    expect(
      um(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conrelid = '${RP}'::regclass AND conname = 'registro_publicado_contrato_enviado_check'`),
    ).toEqual({ def: "CHECK ((contrato_enviado = ANY (ARRAY['v1'::text, 'v2'::text])))" });
  });

  it('backfill: todas as linhas de antes saem v1 (inclusive a recusada fora da fila), sem reescrever a tabela', () => {
    const todas = Object.fromEntries(
      ['aceito', 'anulado', 'cliente', 'cliente-texto', 'inativo', 'lista', 'pendente', 'recusado', 'texto', 'texto-excluido',
        'texto-pendente'].map((r) => [r, 'v1']),
    );
    expect([versoes(A), versoes(B)]).toEqual([todas, todas]);
    expect(um<{ f: string }>(`SELECT pg_relation_filenode('${RP}')::text AS f`).f).toBe(arquivoAntes);
  });

  it('CHECK: versão fora da lista dá 23514, no INSERT e no UPDATE', () => {
    recusaDetalhada(
      banco.conexao,
      `UPDATE ${RP} SET contrato_enviado = 'v3' WHERE registro_external_id = 'aceito';`,
      '23514',
      /registro_publicado_contrato_enviado_check/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO ${RP} (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em,
         ativo, contrato_enviado) VALUES ('${A.id}', 'prazo_pagamento', 'novo', '{}', repeat('6', 64), now(), now(),
         true, 'V2');`,
      '23514',
      /registro_publicado_contrato_enviado_check/,
      WORKER(A),
    );
  });

  it('o índice parcial da varredura existe com a definição combinada', () => {
    expect(um<{ d: string }>(`SELECT indexdef AS d FROM pg_indexes WHERE indexname = '${INDICE}'`).d).toBe(
      `CREATE INDEX ${INDICE} ON integracao_fdv.registro_publicado USING btree (tenant_id, id) WHERE (((entidade)::text = 'prazo_pagamento'::text) AND (NOT pendente) AND (deleted_at IS NULL) AND (payload IS NOT NULL))`,
    );
  });

  it('T-0112: só o prazo fora da fila com parcelas_dias em texto volta a pendente; nada além da flag e do updated_at muda', () => {
    const depois = retrato();
    expect(Object.keys(depois).sort()).toEqual(Object.keys(retratoAntes).sort());
    for (const t of [A, B]) {
      const k = `${t.id}/texto`;
      expect({ k, antes: retratoAntes[k]?.pendente, depois: depois[k]?.pendente }).toEqual({ k, antes: false, depois: true });
      expect(depois[k]?.updated_at).not.toEqual(retratoAntes[k]?.updated_at);
    }
    const sem = (l: Linha | undefined) => {
      const { pendente: _p, updated_at: _u, ...resto } = l ?? {};
      return resto;
    };
    for (const k of Object.keys(depois)) {
      if (k.endsWith('/texto')) expect({ k, l: sem(depois[k]) }).toEqual({ k, l: sem(retratoAntes[k]) });
      else expect({ k, l: depois[k] }).toEqual({ k, l: retratoAntes[k] });
    }
  });

  it('a consulta da varredura acha os prazos resolvidos e fora da fila do tenant (o inativo também), e o plano usa o índice', () => {
    const ids = linhas(
      rodarComo(banco.conexao, `${varreduraSql(A)};`, WORKER(A)),
    ).filter((l) => /^[0-9a-f-]{36}$/.test(l));
    const esperados = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM ${RP} WHERE tenant_id = '${A.id}' AND registro_external_id IN ('aceito', 'recusado', 'inativo', 'lista') ORDER BY id`,
    ).map((r) => r.id);
    expect(ids).toEqual(esperados);
    const plano = rodarScript(
      banco.conexao,
      `SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off; EXPLAIN (COSTS OFF) ${varreduraSql(A)};`,
      { transacao: true },
    );
    expect(plano).toContain(INDICE);
  });

  it('o worker grava a coluna (INSERT e UPDATE) no próprio tenant; RLS: 0 linhas no B', () => {
    expect(privilegiosDe(banco.conexao, 'macuxierp_worker', RP)).toBe('SIU');
    expect(gravar(A, 'v2')).toEqual([1]);
    rodarComo(
      banco.conexao,
      `INSERT INTO ${RP} (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em,
         ativo, contrato_enviado) VALUES ('${A.id}', 'prazo_pagamento', 'novo-v2', '{}', repeat('7', 64), now(), now(),
         true, 'v2');`,
      WORKER(A),
    );
    expect(versoes(A)).toMatchObject({ aceito: 'v2', 'novo-v2': 'v2', recusado: 'v1' });
    expect(gravar(B, 'v2', WORKER(A))).toEqual([0]);
    expect(versoes(B)).toMatchObject({ aceito: 'v1' });
  });

  it('o app só lê a coluna (UPDATE por coluna da 0007 sem ela: 42501); a leitura lê no próprio tenant', () => {
    expect(
      um(`SELECT has_column_privilege('macuxierp_app', '${RP}', 'contrato_enviado', 'SELECT') AS le,
                 has_column_privilege('macuxierp_app', '${RP}', 'contrato_enviado', 'UPDATE') AS grava`),
    ).toEqual({ le: true, grava: false });
    recusaDetalhada(
      banco.conexao,
      `UPDATE ${RP} SET contrato_enviado = 'v1' WHERE registro_external_id = 'aceito';`,
      '42501',
      /permission denied/,
      APP(A),
    );
    expect(
      consultar<{ v: string }>(
        banco.conexao,
        `SELECT DISTINCT tenant_id::text AS v FROM ${RP}`,
        { papel: 'macuxierp_leitura', tenant: B.id },
      ).map((r) => r.v),
    ).toEqual([B.id]);
  });

  it('a 0069 é reexecutável: rodar de novo não muda dado (versão, pendente, updated_at), coluna, CHECK, índice, privilégio nem comentário', () => {
    const r = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT jsonb_agg(jsonb_build_object('i', id, 'v', contrato_enviado, 'p', pendente, 'u', updated_at) ORDER BY id) FROM ${RP}) AS dados,
                (SELECT count(*)::int FROM information_schema.columns
                  WHERE table_schema = 'integracao_fdv' AND table_name = 'registro_publicado') AS colunas,
                (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint WHERE conrelid = '${RP}'::regclass) AS checks,
                (SELECT array_agg(indexdef ORDER BY indexname) FROM pg_indexes
                  WHERE schemaname = 'integracao_fdv' AND tablename = 'registro_publicado') AS indices,
                (SELECT relacl::text FROM pg_class WHERE oid = '${RP}'::regclass) AS acl,
                (SELECT string_agg(attname || '=' || attacl::text, ',' ORDER BY attnum) FROM pg_attribute
                  WHERE attrelid = '${RP}'::regclass AND attacl IS NOT NULL) AS acl_colunas,
                col_description('${RP}'::regclass,
                  (SELECT attnum FROM pg_attribute WHERE attrelid = '${RP}'::regclass AND attname = 'contrato_enviado')::int) AS comentario`,
      );
    const antes = r();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(r()).toEqual(antes);
  });
});
