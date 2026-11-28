/**
 * `operador.sh criar-empresa` (T-0024) pelo empresa.mjs, com um `psql` falso (MACUXIERP_PSQL) que guarda o SQL recebido e
 * devolve a saída ou o erro combinados. Confere o e-mail único no sistema (ADR 0021 §1, T-0133): a checagem entre as
 * empresas vem antes de qualquer INSERT, e o erro dela ou o 23505 do índice da 0079 (corrida) saem com o texto do SDK,
 * código 1 e sem o e-mail. O caminho no PostgreSQL de verdade fica no apps/api/src/operador-empresa.db.test.ts.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const EMPRESA_MJS = resolve(AQUI, 'producao', 'empresa.mjs');
const ERROS_SDK = resolve(AQUI, '..', '..', 'packages', 'platform-sdk', 'src', 'erros.ts');
const EMAIL = 'Admin@Exemplo.invalid';
const pasta = mkdtempSync(join(tmpdir(), 'empresa-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

/** Texto de uma constante `export const NOME = '...'` (ou `const NOME = '...'`) de um fonte. */
function constante(fonte, nome) {
  const m = new RegExp(`const ${nome} =\\s*'([^']+)'`).exec(fonte);
  assert.ok(m, `${nome} não encontrado`);
  return m[1];
}
const MENSAGEM = constante(readFileSync(ERROS_SDK, 'utf8'), 'MENSAGEM_EMAIL_EM_USO');

/** `psql` falso: grava o stdin (o SQL); com `erro`, escreve no stderr e sai 3; senão devolve `saida`. */
function psqlFalso({ saida = '', erro = '' }) {
  const sql = join(pasta, `sql-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(`${sql}.saida`, saida);
  writeFileSync(`${sql}.erro`, erro);
  const bin = `${sql}.psql`;
  writeFileSync(bin, `#!/usr/bin/env bash\ncat > '${sql}'\ncat '${sql}.saida'\nif [ -s '${sql}.erro' ]; then cat '${sql}.erro' >&2; exit 3; fi\n`);
  chmodSync(bin, 0o755);
  return { bin, sql };
}

function empresa(psql, extra = []) {
  const p = psqlFalso(psql);
  const r = spawnSync(process.execPath, [EMPRESA_MJS, '--codigo', 'AM2808', '--operador', 'alexandre', ...extra], {
    env: { PATH: process.env.PATH, MACUXIERP_PSQL: p.bin, MACUXIERP_EMPRESA_NOME: 'Empresa Fictícia Ltda', MACUXIERP_ADMIN_EMAIL: EMAIL, MACUXIERP_ADMIN_NOME: 'Pessoa Fictícia' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  let sql = '';
  try {
    sql = readFileSync(p.sql, 'utf8');
  } catch {
    // o psql não foi chamado
  }
  return { status: r.status, saida: `${r.stdout}${r.stderr}`, sql };
}

describe('empresa.mjs: e-mail único no sistema (ADR 0021 §1, T-0133)', () => {
  it('a mensagem do script é a do SDK (MENSAGEM_EMAIL_EM_USO), travada pelo PO', () => {
    assert.equal(constante(readFileSync(EMPRESA_MJS, 'utf8'), 'MENSAGEM_EMAIL_EM_USO'), MENSAGEM);
    assert.equal(MENSAGEM, 'Este e-mail já está em uso em outra empresa. Use outro e-mail.');
  });

  it('SQL: confere o e-mail (lower(btrim), só vivos) nas OUTRAS empresas antes de qualquer INSERT, sem o e-mail no erro', () => {
    const { sql } = empresa({ saida: 'empresa|am2808|criar|-\nusuario|administrador|criar|-\n' });
    const checagem = sql.indexOf('lower(btrim(uo.email)) = v_email');
    assert.ok(checagem > 0, 'sem a checagem do e-mail');
    assert.match(sql, /lower\(btrim\(uo\.email\)\) = v_email AND uo\.deleted_at IS NULL AND tn\.slug <> v_slug/);
    assert.ok(checagem < sql.indexOf('INSERT INTO plataforma.tenant'), 'a checagem vem antes de criar a empresa');
    assert.ok(checagem < sql.indexOf('INSERT INTO plataforma.usuario'), 'a checagem vem antes de criar o administrador');
    assert.match(sql, /RAISE EXCEPTION 'macuxierp_email_em_uso' USING ERRCODE = 'P0001'/);
    // o e-mail só chega pelo ambiente do psql (\getenv), nunca colado no SQL
    assert.ok(!sql.toLowerCase().includes(EMAIL.toLowerCase()));
  });

  for (const [caso, erro] of [
    ['a checagem do SQL', 'psql:<stdin>:40: ERROR:  macuxierp_email_em_uso\n'],
    ['a corrida (23505 no usuario_email_global_uq da 0079)', `psql:<stdin>:60: ERROR:  duplicate key value violates unique constraint "usuario_email_global_uq"\nDETAIL:  Key (lower(btrim(email)))=(${EMAIL.toLowerCase()}) already exists.\n`],
  ]) {
    it(`e-mail já usado em outra empresa (${caso}): código 1, a mensagem do SDK e nada do e-mail na saída`, () => {
      const r = empresa({ erro });
      assert.equal(r.status, 1);
      assert.ok(r.saida.includes(MENSAGEM), r.saida);
      assert.ok(!r.saida.toLowerCase().includes(EMAIL.toLowerCase()), 'o e-mail não aparece');
      assert.ok(!/estado:/.test(r.saida));
    });
  }

  it('outro erro do psql segue o caminho de sempre (sem a mensagem do e-mail)', () => {
    const r = empresa({ erro: 'psql:<stdin>:10: ERROR:  empresa am2808 existe, mas não está ativa\n' });
    assert.equal(r.status, 1);
    assert.ok(!r.saida.includes(MENSAGEM));
    assert.match(r.saida, /falhou; nada foi gravado/);
  });

  it('sem conflito: a simulação termina como antes (estado: simulacao)', () => {
    const r = empresa({ saida: 'empresa|am2808|criar|-\nusuario|administrador|criar|-\nlicenca|core|ligar|-\n' });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /estado: simulacao/);
  });
});
