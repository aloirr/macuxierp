/**
 * Passo 1 do scripts/deploy/producao/banco.sh (T-0024, fix da v0.2.0): conexão TLS como o admin do DBaaS.
 *
 * Regressão do publicar da v0.1.0: a consulta fazia `coalesce(s.ssl::text, 'f')`; no PostgreSQL `true::text` é 'true'
 * (não 't'), o banco.sh compara com `t` e recusava toda conexão TLS ("conexão SEM TLS com o DBaaS"). A consulta mora em
 * scripts/deploy/producao/conexao-admin.sql (o turbo.json põe a pasta nos inputs desta tarefa, ADR 0014).
 *
 *  1. o .sql contra o Postgres local, com uma view temporária `pg_stat_ssl` (o pg_temp vem antes do pg_catalog na busca de
 *     relações) simulando a conexão COM TLS (sai `t`) e SEM a linha do left join (sai `f`). Sem psql/Postgres, pula,
 *     salvo com MACUXI_PG_EXIGIR=1 (CI), quando falha;
 *  2. o banco.sh --so-conferir com um `docker` falso no PATH (psql falso): com `16.4|t|TLSv1.3|f|f|t|t` passa do passo 1 e
 *     recebe a consulta pelo stdin (`-f -`); com `f` e com o `true` do bug, recusa com saída 3.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'deploy', 'producao');
const SQL = join(PRODUCAO, 'conexao-admin.sql');
const BANCO_SH = join(PRODUCAO, 'banco.sh');

const env = process.env;
const PG_ENV: NodeJS.ProcessEnv = {
  ...env,
  PGHOST: env.MACUXI_PG_HOST ?? '127.0.0.1',
  PGPORT: env.MACUXI_PG_PORTA ?? '5432',
  PGUSER: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  PGDATABASE: 'postgres',
  PGCONNECT_TIMEOUT: '3',
  ...(env.MACUXI_PG_ADMIN_SENHA === undefined ? {} : { PGPASSWORD: env.MACUXI_PG_ADMIN_SENHA }),
};

function psql(args: string[]) {
  const r = spawnSync(env.MACUXI_PSQL ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', ...args], { env: PG_ENV, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : (r.stderr ?? '') };
}

function postgresDisponivel(): boolean {
  const r = psql(['-c', 'select 1']);
  if (r.status === 0 && r.stdout.trim() === '1') return true;
  if (env.MACUXI_PG_EXIGIR === '1') throw new Error(`MACUXI_PG_EXIGIR=1 e o psql/Postgres não respondeu: ${r.stderr}`);
  return false;
}
const PG_DISPONIVEL = postgresDisponivel();

/** Roda o conexao-admin.sql na mesma sessão de uma view temporária que faz o papel do pg_stat_ssl. */
function consultaCom(viewSsl: string): string[] {
  const r = psql(['-c', `create temp view pg_stat_ssl as ${viewSsl}`, '-f', SQL]);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  const linhas = r.stdout.trim().split('\n');
  expect(linhas).toHaveLength(1);
  return linhas[0]!.split('|');
}

describe.skipIf(!PG_DISPONIVEL)('conexao-admin.sql (passo 1 do banco.sh) no Postgres local', () => {
  it('conexão COM TLS: o campo ssl sai t (e não true) e a versão do TLS vem junto', () => {
    const c = consultaCom(`select pg_backend_pid() as pid, true as ssl, 'TLSv1.3'::text as version`);
    expect(c).toHaveLength(7);
    expect(c[1]).toBe('t');
    expect(c[2]).toBe('TLSv1.3');
    for (const b of c.slice(3)) expect(b).toMatch(/^[tf]$/);
  });

  it('sem a linha do pg_stat_ssl (left join vazio): ssl sai f e a versão sai -', () => {
    const c = consultaCom(`select null::integer as pid, null::boolean as ssl, null::text as version where false`);
    expect(c[1]).toBe('f');
    expect(c[2]).toBe('-');
  });

  it('o pg_stat_ssl de verdade (sessão local, sem TLS): sete campos, booleanos em t/f', () => {
    const r = psql(['-f', SQL]);
    expect(r.status).toBe(0);
    const c = r.stdout.trim().split('|');
    expect(c).toHaveLength(7);
    for (const i of [1, 3, 4, 5, 6]) expect(c[i]).toMatch(/^[tf]$/);
  });
});

describe('banco.sh --so-conferir com um psql falso (docker falso no PATH)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'macuxierp-banco-sh-'));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));
  const bin = join(pasta, 'bin');
  const erp = join(pasta, 'macuxierp');
  const registro = join(pasta, 'chamadas.txt');
  for (const d of [bin, erp]) mkdirSync(d, { recursive: true });
  for (const f of ['.env', 'gerados.env', 'banco.env', 'admin.env', 'imagens.env']) writeFileSync(join(erp, f), 'MACUXIERP_FALSO=1\n');
  // `docker compose ... run --rm --no-deps -T psql psql ... -f -`: devolve INFO_FALSO para a consulta do passo 1 (que chega
  // pelo stdin) e nada para as outras (o banco "ainda não existe": o --so-conferir sai 0 sem alterar nada).
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      'entrada="$(cat)"',
      'printf "%s\\n" "$*" >> "$REGISTRO"',
      'case "$entrada" in *pg_stat_ssl*) printf "%s\\n" "$INFO_FALSO" ;; esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'docker'), 0o755);

  function roda(info: string) {
    writeFileSync(registro, '');
    const r = spawnSync('bash', [BANCO_SH, '--so-conferir'], {
      env: { ...env, PATH: `${bin}:${env.PATH ?? ''}`, MACUXIERP_DIR: erp, INFO_FALSO: info, REGISTRO: registro },
      input: '',
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: r.status, saida: `${r.stdout}${r.stderr}`, chamadas: readFileSync(registro, 'utf8') };
  }

  it('16.4|t|TLSv1.3|f|f|t|t passa do passo 1 (a consulta vai pelo stdin com -f -)', () => {
    const r = roda('16.4|t|TLSv1.3|f|f|t|t');
    expect(r.saida).not.toContain('SEM TLS');
    expect(r.saida).toContain('DBaaS: PostgreSQL 16.4, TLS TLSv1.3');
    expect(r.saida).toContain('ainda não existe');
    expect(r.status).toBe(0);
    expect(r.chamadas.split('\n')[0]).toMatch(/ run --rm --no-deps -T psql psql .*-d postgres -f -$/);
  });

  it.each([
    ['f (sem TLS)', '16.4|f|-|f|f|t|t'],
    ['true (o texto que o bug produzia)', '16.4|true|TLSv1.3|f|f|t|t'],
  ])('ssl = %s: recusa com saída 3', (_nome, info) => {
    const r = roda(info);
    expect(r.saida).toContain('conexão SEM TLS com o DBaaS');
    expect(r.status).toBe(3);
  });
});
