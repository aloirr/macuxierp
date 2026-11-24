/**
 * Apoio dos testes de banco (*.db.test.ts): cada arquivo cria um banco efêmero macuxi_teste_*, aplica as migrações
 * (como o admin do ambiente: o superusuário do CI na 5432 ou o admin sem superusuário na 5433) e o apaga no fim.
 * Sem Postgres: pula, salvo com MACUXI_PG_EXIGIR=1 (CI e rodar-antes-do-push.sh), quando falha.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { listarMigracoes } from '../src/migrar.ts';
import {
  type Conexao,
  type Contexto,
  consultar,
  conexaoDoAmbiente,
  ErroPsql,
  executar,
  rodarComo,
  rodarScript,
} from '../src/psql.ts';

const ADMIN = conexaoDoAmbiente(process.env, 'postgres');

function postgresDisponivel(): boolean {
  try {
    rodarScript(ADMIN, 'SELECT 1;');
    return true;
  } catch (e) {
    if (process.env.MACUXI_PG_EXIGIR === '1') {
      throw new Error(`MACUXI_PG_EXIGIR=1 e o Postgres não respondeu: ${(e as Error).message}`);
    }
    return false;
  }
}

export const PG_DISPONIVEL = postgresDisponivel();
export const SEM_SUPERUSUARIO = process.env.MACUXI_PG_ADMIN_SEM_SUPER === '1';

export interface BancoDeTeste {
  conexao: Conexao;
  remover(): void;
}

export function criarBancoDeTeste(): BancoDeTeste {
  const nome = `macuxi_teste_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  rodarScript(ADMIN, `CREATE DATABASE ${nome};`);
  return {
    conexao: { ...ADMIN, banco: nome },
    remover: () => rodarScript(ADMIN, `DROP DATABASE IF EXISTS ${nome};`),
  };
}

export interface PastaDeMigracoes {
  pasta: string;
  remover(): void;
}

/**
 * Pasta temporária só com as migrações anteriores ao prefixo (mesmos nomes e sha256 das originais), para testar uma
 * migração sobre linhas gravadas antes dela.
 */
export function pastaComMigracoesAntesDe(prefixo: string): PastaDeMigracoes {
  const pasta = mkdtempSync(join(tmpdir(), `macuxi-${prefixo}-`));
  for (const m of listarMigracoes().filter((x) => x.nome < prefixo))
    copyFileSync(m.caminho, join(pasta, m.nome));
  return { pasta, remover: () => rmSync(pasta, { recursive: true, force: true }) };
}

/**
 * O admin precisa ser membro dos papéis (e do macuxierp_config, 0033) para o SET ROLE dos testes. O superusuário já
 * pode; o admin sem superusuário criou os papéis (tem ADMIN OPTION) e se concede. Concessão concorrente de outro arquivo
 * de teste não é erro.
 */
export function permitirSetRole(c: Conexao): void {
  rodarScript(
    c,
    `DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    BEGIN
      GRANT macuxierp_app, macuxierp_worker, macuxierp_leitura TO CURRENT_USER;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    -- macuxierp_config (0033) só existe depois da migração: concessão à parte, para não derrubar as outras.
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'macuxierp_config') THEN
        GRANT macuxierp_config TO CURRENT_USER;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;`,
  );
}

export const PAPEIS_APP = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
export type PapelApp = (typeof PAPEIS_APP)[number];

export interface Tabela {
  esquema: string;
  tabela: string;
}

export function tabelasDos(c: Conexao, esquemas: readonly string[]): Tabela[] {
  return consultar<Tabela>(
    c,
    `SELECT n.nspname AS esquema, k.relname AS tabela FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
     WHERE k.relkind IN ('r', 'p') AND n.nspname IN (${esquemas.map((e) => `'${e}'`).join(', ')})
     ORDER BY 1, 2`,
  );
}

/** O papel lê a tabela (privilégio na tabela ou em alguma coluna)? */
export function papelLe(c: Conexao, papel: PapelApp, t: Tabela): boolean {
  const [r] = consultar<{ le: boolean }>(
    c,
    `SELECT has_any_column_privilege('${papel}', '${t.esquema}.${t.tabela}', 'SELECT') AS le`,
  );
  return r?.le === true;
}

/**
 * Linhas que o papel vê no tenant e quantas são de outro tenant. `geral`: a tabela tem leitura geral (política
 * leitura_geral, D9), e as linhas do tenant de referência não contam como vazamento; nas demais, contam.
 */
export function contarComo(
  c: Conexao,
  papel: PapelApp,
  tenant: string | null,
  t: Tabela,
  tenantAlvo: string,
  geral = false,
): { total: number; alheias: number } {
  const referencia = geral ? ' AND tenant_id <> plataforma.tenant_referencia()' : '';
  const [r] = consultar<{ total: number; alheias: number }>(
    c,
    `SELECT count(tenant_id)::int AS total,
       count(tenant_id) FILTER (WHERE tenant_id <> '${tenantAlvo}'${referencia})::int AS alheias
     FROM ${t.esquema}.${t.tabela}`,
    { papel, tenant },
  );
  return r ?? { total: 0, alheias: 0 };
}

/** Privilégios do papel na tabela (esquema.tabela), em letras: S, I, U, D, T; '-' = nenhum. */
export function privilegiosDe(c: Conexao, papel: string, tabela: string): string {
  const [r] = consultar<{ p: string }>(
    c,
    `SELECT concat(${['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
      .map((p) => `CASE WHEN has_table_privilege('${papel}', '${tabela}', '${p}') THEN '${p[0]}' END`)
      .join(', ')}) AS p`,
  );
  return r?.p || '-';
}

/** Mensagem do erro do psql, ou null se o comando passou. */
export function erroDe(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ErroPsql ? e.message : String(e);
  }
}

/** Mensagem do erro esperado; falha o teste se o comando passou. */
export function falha(fn: () => unknown): string {
  const erro = erroDe(fn);
  if (erro === null) throw new Error('era para falhar e passou');
  return erro;
}

/**
 * Erro do psql com a saída completa (DETAIL, e o SQLSTATE com `\set VERBOSITY verbose`), ou null se o comando passou.
 * Erro que não é do psql sobe.
 */
export function erroDetalhadoDe(fn: () => unknown): { mensagem: string; saida: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ErroPsql) return { mensagem: e.message, saida: e.saida };
    throw e;
  }
}

/** Como `falha`, com a saída completa do psql. */
export function falhaDetalhada(fn: () => unknown): { mensagem: string; saida: string } {
  const erro = erroDetalhadoDe(fn);
  if (erro === null) throw new Error('era para falhar e passou');
  return erro;
}

/** Liga o SQLSTATE na saída do psql (`\set VERBOSITY verbose`), para `falhaDetalhada` conferir o código. */
export const verboso = (sql: string): string => `\\set VERBOSITY verbose\n${sql}`;

/** Falha esperada, com o SQLSTATE (`codigo`) na saída do psql e o `padrao` na mensagem; o SQL vai junto no erro. */
export function recusaDetalhada(
  conexao: Conexao,
  sql: string,
  codigo: string,
  padrao: RegExp,
  ctx?: Contexto,
): void {
  const e = falhaDetalhada(() => executar(conexao, verboso(sql), ctx));
  expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringContaining(codigo) });
  expect({ sql, mensagem: e.mensagem }).toMatchObject({ sql, mensagem: expect.stringMatching(padrao) });
}

/** Recusa com o SQLSTATE e o DETAIL exatos (o primeiro token do DETAIL do psql verboso). */
export function recusaComDetalhe(
  conexao: Conexao,
  sql: string,
  codigo: string,
  detalhe: string,
  ctx?: Contexto,
): void {
  const e = falhaDetalhada(() => executar(conexao, verboso(sql), ctx));
  expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringContaining(codigo) });
  expect({ sql, detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1] }).toEqual({ sql, detalhe });
}

/** Recusa conferida numa chamada só: o SQLSTATE na saída, o DETAIL exato (primeiro token) e a mensagem. */
export function recusaCompleta(
  conexao: Conexao,
  sql: string,
  esperado: { codigo: string; detalhe: string | undefined; mensagem: RegExp },
  ctx?: Contexto,
): void {
  const e = falhaDetalhada(() => executar(conexao, verboso(sql), ctx));
  expect({
    sql,
    codigo: e.saida.includes(esperado.codigo),
    detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1],
    mensagem: e.mensagem,
  }).toEqual({
    sql,
    codigo: true,
    detalhe: esperado.detalhe,
    mensagem: expect.stringMatching(esperado.mensagem),
  });
}

/** Linhas não vazias da saída do psql (valores de RETURNING e SELECT de uma coluna de texto). */
export const linhas = (saida: string): string[] =>
  saida
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** Linhas da saída do psql que são inteiros (os valores de RETURNING e SELECT de uma coluna numérica). */
export const numeros = (saida: string): number[] =>
  saida
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^-?\d+$/.test(l))
    .map(Number);

/** Prefixo SQL que liga a sessão de superadmin do portal /config na transação (null = sem sessão). */
export const sessaoSql = (sessao: string | null): string =>
  sessao === null ? '' : `SET LOCAL macuxierp.sessao_superadmin = '${sessao}';\n`;

export { consultar, executar, rodarComo, rodarScript };
