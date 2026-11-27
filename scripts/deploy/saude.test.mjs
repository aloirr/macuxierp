/**
 * `operador.sh saude` (D3, v0.3.18) pelo saude.mjs, com um `psql` falso (MACUXIERP_PSQL) que guarda o SQL recebido e
 * devolve linhas prontas. Confere: transação READ ONLY sem escrita, nenhuma coluna de nome ou documento no SQL, só as
 * linhas `saude` bem formadas na saída e a falha do banco como saída 1.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SQL_SAUDE, linhasSaude } from './producao/saude.mjs';

const SAUDE_MJS = resolve(dirname(fileURLToPath(import.meta.url)), 'producao', 'saude.mjs');
const US = '\u001f';
const pasta = mkdtempSync(join(tmpdir(), 'saude-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

function rodar({ saida = '', codigo = 0 } = {}) {
  const sql = join(pasta, `sql-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(`${sql}.resposta`, saida);
  const bin = `${sql}.psql`;
  writeFileSync(bin, `#!/usr/bin/env bash\ncat > '${sql}'\ncat '${sql}.resposta'\n${codigo ? `echo 'ERROR:  relation x does not exist' >&2\nexit ${codigo}\n` : ''}`);
  chmodSync(bin, 0o755);
  // como o operador.sh roda: o script pelo stdin do node
  const r = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: readFileSync(SAUDE_MJS, 'utf8'),
    env: { PATH: process.env.PATH, MACUXIERP_PSQL: bin },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, sql: readFileSync(sql, 'utf8') };
}

const linha = (...c) => ['saude', ...c].join(US);

describe('saude.mjs (D3, v0.3.18)', () => {
  it('só lê: BEGIN READ ONLY, ROLLBACK e nenhuma escrita', () => {
    assert.match(SQL_SAUDE, /^BEGIN READ ONLY;/);
    assert.match(SQL_SAUDE.trim(), /ROLLBACK;$/);
    assert.doesNotMatch(SQL_SAUDE, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b/i);
  });

  it('LGPD: nenhuma coluna de nome, e-mail, documento ou dado de cadastro; a empresa sai pelo código', () => {
    assert.doesNotMatch(SQL_SAUDE, /\b(nome|razao_social|email|cnpj|cpf|documento|external_id|corpo|depois|antes)\b/i);
    assert.match(SQL_SAUDE, /t\.slug/);
  });

  it('imprime uma linha por empresa e a linha de estado; ignora o que vier fora do formato', () => {
    const saida = [
      linha('am2808', '2026-11-27T05:40:00Z', '200', '-', '12', '0', '1'),
      linha('rr1234', '-', '401', 'cliente:credencial,produto:credencial', '0', '3', '0'),
      linha('Nome Com Espaço', '-', '-', '-', '0', '0', '0'),
      'outra coisa do banco',
    ].join('\n');
    const r = rodar({ saida });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /am2808 \| 2026-11-27T05:40:00Z \| 200 \| - \| 12\/0 \| 1/);
    assert.match(r.stdout, /rr1234 \| - \| 401 \| cliente:credencial,produto:credencial \| 0\/3 \| 0/);
    assert.doesNotMatch(r.stdout, /Nome Com Espaço|outra coisa/);
    assert.match(r.stdout, /estado: saude 2 empresa\(s\)$/m);
    assert.equal(r.sql, SQL_SAUDE);
  });

  it('falha do banco: saída 1, só a primeira linha do erro', () => {
    const r = rodar({ codigo: 3 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[saude\] falhou/);
  });

  it('linhasSaude descarta contagem que não é número', () => {
    assert.deepEqual(linhasSaude(linha('am2808', '-', '-', '-', 'x', '0', '0')), []);
  });
});
