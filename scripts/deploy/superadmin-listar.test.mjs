/**
 * `operador.sh superadmin --listar` (T-0103) pelo superadmin.mjs, com um `psql` falso (MACUXIERP_PSQL) que guarda o SQL
 * recebido e devolve linhas prontas. Confere: só a escrita da auditoria (sem UPDATE nem DELETE), o e-mail só pela
 * `plataforma.mascarar_email`, os argumentos recusados (exit 2) e a saída sem e-mail completo.
 * O caminho no PostgreSQL de verdade fica no apps/api/src/operador-superadmin.db.test.ts.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SUPERADMIN_MJS = resolve(dirname(fileURLToPath(import.meta.url)), 'producao', 'superadmin.mjs');
const US = '\u001f';
const pasta = mkdtempSync(join(tmpdir(), 'superadmin-listar-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

/** `psql` falso: grava o stdin (o SQL) e devolve o conteúdo de `saida`. */
function psqlFalso(saida) {
  const sql = join(pasta, `sql-${Math.random().toString(36).slice(2)}.txt`);
  const resposta = `${sql}.resposta`;
  writeFileSync(resposta, saida);
  const bin = `${sql}.psql`;
  writeFileSync(bin, `#!/usr/bin/env bash\ncat > '${sql}'\ncat '${resposta}'\n`);
  chmodSync(bin, 0o755);
  return { bin, sql };
}

function listar({ saida = '', extra = [], env = {}, bin } = {}) {
  const p = psqlFalso(saida);
  if (bin) writeFileSync(p.bin, bin);
  const r = spawnSync(process.execPath, [SUPERADMIN_MJS, '--acao', 'listar', '--operador', 'alexandre', ...extra], {
    env: { PATH: process.env.PATH, MACUXIERP_PSQL: p.bin, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  let sql = '';
  try {
    sql = readFileSync(p.sql, 'utf8');
  } catch {
    // o psql não foi chamado
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, sql };
}

const linha = (...c) => ['superadmin-lista', ...c].join(US);

describe('superadmin.mjs --acao listar (T-0103)', () => {
  it('SQL: e-mail só mascarado; a única escrita é a auditoria plataforma.superadmin.listar, com operador e contagem pelo \\getenv', () => {
    const { status, sql } = listar();
    assert.equal(status, 0);
    assert.match(sql, /\nBEGIN;\n/);
    assert.match(sql, /\nCOMMIT;\n$/);
    assert.match(sql, /plataforma\.mascarar_email\(s\.email\)/);
    assert.equal(sql.match(/\bemail\b/g)?.length, 1);
    assert.equal(sql.match(/\bINSERT INTO\b/g)?.length, 1);
    assert.match(sql, /INSERT INTO plataforma\.auditoria .*\n.*'plataforma\.superadmin\.listar'.*\n.*'quantidade', count\(\*\), 'operador', :'operador'/);
    assert.match(sql, /\\getenv operador MACUXIERP_OP_OPERADOR/);
    assert.doesNotMatch(sql, /\b(UPDATE|DELETE)\b/i);
    assert.doesNotMatch(sql, /alexandre/); // o operador vem pelo ambiente, nunca colado no SQL
    assert.match(sql, /WHERE s\.deleted_at IS NULL/);
  });

  it('imprime um superadmin por linha, só com o que o banco devolveu, e termina em "estado: lista"', () => {
    const saida = [
      linha('11111111-1111-4111-8111-111111111111', 'su****@exemplo.invalid', 'ativo', 'não', 'não', '0', 'não', '24/11/2026 22:40'),
      linha('22222222-2222-4222-8222-222222222222', '*****@exemplo.invalid', 'desativado', 'sim', 'sim', '5', 'sim', 'nunca'),
      'lixo|que|não|é|da|lista',
    ].join('\n');
    const { status, stdout } = listar({ saida: `${saida}\n` });
    assert.equal(status, 0);
    const linhas = stdout.trim().split('\n');
    assert.match(linhas[0], /LISTA: 2 superadmin\(s\)\./);
    assert.match(linhas[1], /id: 11111111-.* · e-mail \(mascarado\): su\*\*\*\*@exemplo\.invalid · situação: ativo .* último acesso \(Manaus\): 24\/11\/2026 22:40/);
    assert.match(linhas[2], /situação: desativado · troca pendente: sim · travado: sim · falhas: 5 · temporária pendente: sim · último acesso \(Manaus\): nunca/);
    assert.equal(linhas.at(-1), 'estado: lista');
    assert.equal(linhas.length, 4);
  });

  it('lista vazia: 0 superadmin(s) e "estado: lista"', () => {
    const { status, stdout } = listar();
    assert.equal(status, 0);
    assert.match(stdout, /: 0 superadmin\(s\)\.\nestado: lista\n$/);
  });

  it('recusa --confirmar, e-mail, nome e senha no ambiente (saída 2, sem chamar o psql)', () => {
    for (const caso of [
      { extra: ['--confirmar'] },
      { env: { MACUXIERP_SUPERADMIN_EMAIL: 'pessoa@exemplo.invalid' } },
      { env: { MACUXIERP_SUPERADMIN_NOME: 'Pessoa' } },
      { env: { MACUXIERP_SENHA_INICIAL: 'Abc123!Abc123!Ab' } },
    ]) {
      const r = listar(caso);
      assert.equal(r.status, 2, JSON.stringify(caso));
      assert.equal(r.sql, '');
      assert.doesNotMatch(`${r.stdout}${r.stderr}`, /pessoa@exemplo\.invalid|Abc123/);
    }
  });

  it('falha do psql: saída 1, sem nada além do erro mascarado', () => {
    const r = listar({ bin: '#!/usr/bin/env bash\ncat > /dev/null\necho "psql: ERROR: falhou" >&2\nexit 3\n' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /falhou; nada foi gravado/);
    assert.doesNotMatch(r.stdout, /estado:/);
  });
});
