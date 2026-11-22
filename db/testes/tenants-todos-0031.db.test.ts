/** T-0045, migração 0031: plataforma.tenants_todos() para a purga de 400 dias do sefaz_simulador (LGPD). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0031_tenants_todos.sql', import.meta.url));
const ATIVO = novoTenant('todos-0031-ativo');
const SUSPENSO = novoTenant('todos-0031-suspenso');
const ENCERRADO = novoTenant('todos-0031-encerrado');
const EXCLUIDO = novoTenant('todos-0031-excluido');
const SQL = 'SELECT t AS id FROM plataforma.tenants_todos() t';

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — tenants_todos() (T-0045, 0031)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [ATIVO, SUSPENSO, ENCERRADO, EXCLUIDO].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n') +
        `\nUPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${SUSPENSO.id}';` +
        `\nUPDATE plataforma.tenant SET situacao = 'encerrado' WHERE id = '${ENCERRADO.id}';` +
        `\nUPDATE plataforma.tenant SET deleted_at = now() WHERE id = '${EXCLUIDO.id}';`,
    );
  });

  afterAll(() => banco?.remover());

  const todos = (): string[] =>
    consultar<{ id: string }>(banco.conexao, 'SELECT id FROM plataforma.tenant ORDER BY id').map((r) => r.id);

  it('o worker, sem tenant na sessão, recebe todos os ids: ativo, suspenso, encerrado e excluído (deleted_at)', () => {
    const ids = consultar<{ id: string }>(banco.conexao, SQL, { papel: 'macuxierp_worker' }).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([ATIVO.id, SUSPENSO.id, ENCERRADO.id, EXCLUIDO.id]));
    // Igual à tabela inteira (inclusive o tenant de referência da 0002), em ordem de id.
    expect(ids).toEqual(todos());
    // A tenants_ativos() da 0009 continua só com o ativo destes quatro.
    const ativos = consultar<{ id: string }>(banco.conexao, 'SELECT t AS id FROM plataforma.tenants_ativos() t', {
      papel: 'macuxierp_worker',
    }).map((r) => r.id);
    expect(ativos.filter((id) => [ATIVO.id, SUSPENSO.id, ENCERRADO.id, EXCLUIDO.id].includes(id))).toEqual([
      ATIVO.id,
    ]);
    // Sem tenant na sessão, a tabela em si continua fechada para o worker.
    expect(consultar(banco.conexao, 'SELECT id FROM plataforma.tenant', { papel: 'macuxierp_worker' })).toEqual([]);
  });

  it('app e leitura recebem 42501 (permission denied)', () => {
    for (const papel of ['macuxierp_app', 'macuxierp_leitura']) {
      recusaDetalhada(banco.conexao, `${SQL};`, '42501', /permission denied/, { papel, tenant: ATIVO.id });
    }
  });

  it('SECURITY DEFINER, STABLE, search_path fixo, SETOF uuid, com comentário; EXECUTE só do worker (nem PUBLIC)', () => {
    const [f] = consultar<{
      definer: boolean;
      vol: string;
      cfg: string;
      ret: string;
      setof: boolean;
      comentado: boolean;
      publico: boolean;
      app: boolean;
      leitura: boolean;
      worker: boolean;
    }>(
      banco.conexao,
      `SELECT p.prosecdef AS definer, p.provolatile AS vol, array_to_string(p.proconfig, ',') AS cfg,
         p.prorettype::regtype::text AS ret, p.proretset AS setof,
         obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
         EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS publico,
         has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
         has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker
       FROM pg_proc p WHERE p.oid = 'plataforma.tenants_todos'::regproc`,
    );
    expect(f).toEqual({
      definer: true,
      vol: 's',
      cfg: 'search_path=pg_catalog, pg_temp',
      ret: 'uuid',
      setof: true,
      comentado: true,
      publico: false,
      app: false,
      leitura: false,
      worker: true,
    });
  });

  it('a 0031 reexecuta sem erro e mantém o resultado e os privilégios', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(consultar<{ id: string }>(banco.conexao, SQL, { papel: 'macuxierp_worker' }).map((r) => r.id)).toEqual(
      todos(),
    );
    recusaDetalhada(banco.conexao, `${SQL};`, '42501', /permission denied/, { papel: 'macuxierp_app' });
  });
});
