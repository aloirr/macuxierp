/**
 * T-0104 (v0.3.15), migração 0066 (RN-INF-06): sai a integracao_fdv.expurgar_pre_cadastro_recusado da 0057; o
 * expurgo diário fica só na expurgar_pre_cadastro da 0062, com o COMMENT ON sem citar a antiga. Reexecutável.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { type BancoDeTeste, consultar, criarBancoDeTeste, PG_DISPONIVEL, rodarScript } from './apoio.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0066_integracao_fdv_drop_expurgo_recusado.sql', import.meta.url));
const EXPURGO = 'integracao_fdv.expurgar_pre_cadastro(timestamptz)';

let banco: BancoDeTeste;
const um = <T,>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
const estado = (): unknown =>
  um(`SELECT (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'integracao_fdv' AND p.proname LIKE 'expurgar\\_%') AS funcoes,
             (SELECT proacl::text FROM pg_proc WHERE oid = '${EXPURGO}'::regprocedure) AS acl,
             obj_description('${EXPURGO}'::regprocedure, 'pg_proc') AS comentario`);

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — sai a expurgar_pre_cadastro_recusado (T-0104, 0066)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
  });

  afterAll(() => banco?.remover());

  it('a expurgar_pre_cadastro_recusado não existe mais; a expurgar_pre_cadastro fica, só do worker', () => {
    expect(um(`SELECT to_regprocedure('integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz)') AS f`)).toEqual({ f: null });
    expect(
      um(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'integracao_fdv' AND p.proname = 'expurgar_pre_cadastro_recusado'`),
    ).toEqual({ n: 0 });
    expect(
      um(`SELECT has_function_privilege('macuxierp_worker', '${EXPURGO}'::regprocedure, 'EXECUTE') AS worker,
                 has_function_privilege('macuxierp_app', '${EXPURGO}'::regprocedure, 'EXECUTE') AS app`),
    ).toEqual({ worker: true, app: false });
  });

  it('o COMMENT ON da expurgar_pre_cadastro traz a regra do recusado sem citar a função que saiu', () => {
    const { c } = um<{ c: string }>(`SELECT obj_description('${EXPURGO}'::regprocedure, 'pg_proc') AS c`);
    expect(c).toMatch(/RN-INF-06/);
    expect(c).toMatch(/nenhuma revisão do mesmo pré-cadastro \(cliente_uuid\) tem recusa em p_corte ou depois/);
    expect(c).not.toMatch(/expurgar_pre_cadastro_recusado/);
  });

  it('a 0066 é reexecutável: rodar de novo não dá erro nem muda função, privilégio ou comentário', () => {
    const antes = estado();
    expect(antes).toMatchObject({ funcoes: ['expurgar_pre_cadastro'] });
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(estado()).toEqual(antes);
  });
});
