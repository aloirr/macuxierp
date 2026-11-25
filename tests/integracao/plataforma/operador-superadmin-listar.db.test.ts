/**
 * T-0103 (plano da v0.3.13, O-1 e O-2): `operador.sh superadmin --listar` DE VERDADE, com o `docker` falso
 * (tests/apoio/operador-falso.ts) que roda o superadmin.mjs contra o PostgreSQL efêmero e um `psql` de passagem que
 * guarda o SQL, o argv e o ambiente. O formato da linha e o SQL com o psql falso ficam no
 * scripts/deploy/superadmin-listar.test.mjs (dono); aqui entram a costura operador.sh → superadmin.mjs → banco:
 * - O-1: cada superadmin vivo numa linha, com o e-mail mascarado pela `plataforma.mascarar_email` do próprio banco, a
 *   situação (ativo ou desativado) e o último acesso em Manaus ("nunca" sem acesso); o excluído fica de fora; nenhum
 *   e-mail inteiro nem a parte local na saída, no argv nem no ambiente do psql;
 * - O-2: só leitura (BEGIN READ ONLY, nenhuma linha de plataforma.superadmin muda, nenhuma auditoria nova); sem
 *   --operador, com --email ou com --confirmar, recusa sem chamar o banco; sem superadmin, "0 superadmin(s)" e saída 0.
 * Fora daqui (vai por recado ao engenheiro-software): o critério "registra quem pediu (--operador)" da T-0103; hoje o
 * --listar exige o --operador mas não o grava em lugar nenhum (o superadmin.mjs diz "nada gravado nem auditado").
 * Dados fictícios (exemplo.invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { envPsqlAdmin } from '../../../apps/api/src/apoio-operador-teste';
import { criarDockerFalso } from '../../apoio/operador-falso';
import { inserirSuperadmin } from '../../apoio/portal-pg';

const OPERADOR_SH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'deploy', 'producao', 'operador.sh');
const ATIVO = 'helena.listar.t0103@exemplo.invalid';
const DESATIVADO = 'otavio.listar.t0103@exemplo.invalid';
const TRAVADO = 'yara.listar.t0103@exemplo.invalid';
const EXCLUIDO = 'excluido.listar.t0103@exemplo.invalid';
const VIVOS = [ATIVO, DESATIVADO, TRAVADO];
/** 24/11/2026 22:40 em Manaus (UTC−4). */
const ULTIMO_ACESSO_UTC = '2026-11-25T02:40:00Z';

describe.skipIf(!PG_DISPONIVEL)('operador.sh superadmin --listar no PostgreSQL (T-0103, O-1 e O-2)', () => {
  let b: BancoEfemero;
  let pasta = '';
  let bin = '';
  let erp = '';
  let sqlLog = '';
  let psqlLog = '';
  const saidas: string[] = [];

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'macuxierp-t0103-listar-'));
    ({ bin, erp } = criarDockerFalso(pasta, { repassar: ['PSQL_REAL', 'SQL_LOG', 'PSQL_LOG'] }));
    sqlLog = join(pasta, 'sql.txt');
    psqlLog = join(pasta, 'psql-argv.txt');
    writeFileSync(
      join(bin, 'psql-passagem'),
      ['#!/usr/bin/env bash', 'sql="$(cat)"', 'printf "%s\\n" "$sql" >> "$SQL_LOG"', 'printf "%s\\n" "$@" >> "$PSQL_LOG"', 'env >> "$PSQL_LOG.ambiente"', 'exec "$PSQL_REAL" "$@" <<< "$sql"', ''].join('\n'),
    );
    chmodSync(join(bin, 'psql-passagem'), 0o755);
    b = await criarBancoEfemero();
    for (const e of [...VIVOS, EXCLUIDO]) await inserirSuperadmin(b, e);
    await b.admin.query('UPDATE plataforma.superadmin SET ultimo_acesso_em = $2 WHERE email = $1', [ATIVO, ULTIMO_ACESSO_UTC]);
    await b.admin.query('UPDATE plataforma.superadmin SET ativo = false WHERE email = $1', [DESATIVADO]);
    // hora-fixa-ok: trava e exclusão relativas ao relógio do banco, nunca comparadas com o instante fixo do último acesso
    await b.admin.query("UPDATE plataforma.superadmin SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes' WHERE email = $1", [TRAVADO]);
    // hora-fixa-ok: só marca excluído, nunca comparado com o instante fixo
    await b.admin.query('UPDATE plataforma.superadmin SET deleted_at = now() WHERE email = $1', [EXCLUIDO]);
  }, 180_000);
  afterAll(async () => {
    await b?.remover();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  /** Roda o operador.sh como na VM; devolve status, saída, o SQL e o argv/ambiente que chegaram ao psql nesta chamada. */
  function operador(args: string[]) {
    for (const f of [sqlLog, psqlLog, `${psqlLog}.ambiente`]) writeFileSync(f, '');
    const r = spawnSync('bash', [OPERADOR_SH, ...args], {
      env: {
        ...envPsqlAdmin(b.nome),
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: pasta,
        MACUXIERP_DIR: erp,
        NODE_REAL: process.execPath,
        MACUXIERP_PSQL: join(bin, 'psql-passagem'),
        PSQL_REAL: process.env.MACUXI_PSQL ?? 'psql',
        SQL_LOG: sqlLog,
        PSQL_LOG: psqlLog,
      },
      input: '',
      encoding: 'utf8',
      timeout: 120_000,
    });
    const saida = `${r.stdout}${r.stderr}`;
    saidas.push(saida);
    return { status: r.status, saida, sql: readFileSync(sqlLog, 'utf8'), psql: `${readFileSync(psqlLog, 'utf8')}\n${readFileSync(`${psqlLog}.ambiente`, 'utf8')}` };
  }
  const listar = (extra: string[] = ['--operador', 'alexandre']) => operador(['superadmin', '--listar', ...extra]);
  const tabela = async () => (await b.admin.query('SELECT * FROM plataforma.superadmin ORDER BY id')).rows;
  const auditorias = async () => Number((await b.admin.query<{ n: string }>('SELECT count(*) AS n FROM plataforma.auditoria')).rows[0]!.n);
  const mascarado = async (email: string) => (await b.admin.query<{ m: string }>('SELECT plataforma.mascarar_email($1) AS m', [email])).rows[0]!.m;
  /** A linha da saída do superadmin com o e-mail mascarado dado. */
  const linhaDe = (saida: string, m: string) => saida.split('\n').filter((l) => l.includes(`e-mail (mascarado): ${m} `));

  it('O-1: um superadmin vivo por linha, com o e-mail mascarado pelo banco, a situação e o último acesso em Manaus; o excluído fica de fora', async () => {
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.saida).toContain('3 superadmin(s)');
    expect(r.saida.trim().split('\n').at(-1)).toBe('estado: lista');
    const esperado: Record<string, RegExp> = {
      [ATIVO]: /situação: ativo · .*último acesso \(Manaus\): 24\/11\/2026 22:40$/,
      [DESATIVADO]: /situação: desativado · .*último acesso \(Manaus\): nunca$/,
      [TRAVADO]: /situação: ativo · .*travado: sim · falhas: 5 · .*último acesso \(Manaus\): nunca$/,
    };
    const mascaras = await Promise.all(VIVOS.map(mascarado));
    expect(new Set(mascaras).size).toBe(VIVOS.length);
    for (const [i, email] of VIVOS.entries()) {
      const m = mascaras[i]!;
      expect(m).not.toBe(email);
      expect(m).toContain('*');
      const l = linhaDe(r.saida, m);
      expect(l, `linha de ${m}`).toHaveLength(1);
      expect(l[0]!.trim()).toMatch(esperado[email]!);
    }
    expect(r.saida).not.toContain(await mascarado(EXCLUIDO));
  });

  it('O-1 (regra 8): nenhum e-mail inteiro nem a parte local na saída, no SQL, no argv nem no ambiente do psql', () => {
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.sql).not.toBe('');
    for (const email of [...VIVOS, EXCLUIDO]) {
      const local = email.split('@')[0]!;
      for (const texto of [r.saida, r.sql, r.psql, ...saidas]) {
        expect(texto.toLowerCase()).not.toContain(email);
        expect(texto.toLowerCase()).not.toContain(local);
      }
    }
    expect(r.psql).not.toMatch(/MACUXIERP_SUPERADMIN_EMAIL=/);
  });

  it('O-2: só leitura: BEGIN READ ONLY, nenhuma coluna de plataforma.superadmin muda e nenhuma auditoria nova', async () => {
    const antes = await tabela();
    const aud = await auditorias();
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.sql).toMatch(/^BEGIN READ ONLY;$/m);
    expect(r.sql).not.toMatch(/^(BEGIN|COMMIT);$/m);
    expect(await tabela()).toEqual(antes);
    expect(await auditorias()).toBe(aud);
  });

  it('O-2: sem --operador, com --email ou com --confirmar, recusa sem chamar o banco', () => {
    for (const extra of [[], ['--operador', 'alexandre', '--email', ATIVO], ['--operador', 'alexandre', '--confirmar'], ['--operador', 'X maiúsculo']]) {
      const r = listar(extra);
      expect(r.status, JSON.stringify(extra)).not.toBe(0);
      expect(r.sql, JSON.stringify(extra)).toBe('');
      expect(r.saida).not.toContain('estado: lista');
    }
  });

  it('O-2: sem superadmin vivo, "0 superadmin(s)" e saída 0', async () => {
    // hora-fixa-ok: só marca excluído, nunca comparado com o instante fixo
    await b.admin.query('UPDATE plataforma.superadmin SET deleted_at = now() WHERE deleted_at IS NULL');
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.saida).toContain(': 0 superadmin(s).');
    expect(r.saida.trim().split('\n').at(-1)).toBe('estado: lista');
  });
});
