/**
 * `operador.sh ... --sem-mostrar-senha` (decisão 22 B, workflow "producao — superadmin"): a senha provisória é gerada e
 * entra no contêiner pelo ambiente, mas nunca aparece na saída nem nos erros (a saída vai para o log do GitHub Actions).
 * O `docker` é falso: grava a senha recebida pelo ambiente (-e MACUXIERP_SENHA_INICIAL) e devolve a linha de estado pedida.
 * Dados fictícios. O caminho no PostgreSQL de verdade fica no tests/integracao/plataforma/operador-superadmin.db.test.ts.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const OPERADOR = resolve(dirname(fileURLToPath(import.meta.url)), 'producao', 'operador.sh');
const EMAIL = 'sa-22b@exemplo.invalid';
const pasta = mkdtempSync(join(tmpdir(), 'operador-sem-senha-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

const bin = join(pasta, 'bin');
const erp = join(pasta, 'macuxierp');
const senhaRecebida = join(pasta, 'senha-recebida');
for (const d of [bin, erp]) mkdirSync(d, { recursive: true });
for (const f of ['.env', 'gerados.env', 'banco.env', 'admin.env', 'imagens.env']) writeFileSync(join(erp, f), 'MACUXIERP_FALSO=1\n');
writeFileSync(
  join(bin, 'docker'),
  ['#!/usr/bin/env bash', 'cat > /dev/null', `printf '%s' "\${MACUXIERP_SENHA_INICIAL-}" > '${senhaRecebida}'`, 'printf "[superadmin] falso\\n%s\\n" "$ESTADO_FALSO"', ''].join('\n'),
);
chmodSync(join(bin, 'docker'), 0o755);

function rodar(args, estado) {
  rmSync(senhaRecebida, { force: true });
  const r = spawnSync('bash', [OPERADOR, ...args], {
    env: { PATH: `${bin}:${process.env.PATH}`, MACUXIERP_DIR: erp, ESTADO_FALSO: estado },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const senha = existsSync(senhaRecebida) ? readFileSync(senhaRecebida, 'utf8') : '';
  return { status: r.status, saida: `${r.stdout}\n${r.stderr}`, senha };
}

describe('operador.sh --sem-mostrar-senha (decisão 22 B)', () => {
  it('criar-superadmin --confirmar: a senha vai ao contêiner, mas não aparece; a saída aponta o "Esqueci a senha"', () => {
    const r = rodar(['criar-superadmin', '--email', EMAIL, '--nome', 'Alexandre', '--operador', 'alexandre', '--sem-mostrar-senha', '--confirmar'], 'estado: superadmin-criado');
    assert.equal(r.status, 0, r.saida);
    assert.equal(r.senha.length, 16);
    assert.ok(!r.saida.includes(r.senha), 'a senha apareceu na saída');
    assert.doesNotMatch(r.saida, /aparece só agora/);
    assert.match(r.saida, /NÃO mostrada/);
    assert.match(r.saida, /Esqueci a senha/);
    assert.ok(!r.saida.includes(EMAIL), 'o e-mail apareceu na saída');
  });

  it('superadmin --redefinir-senha --confirmar: a nova senha também não aparece', () => {
    const r = rodar(['superadmin', '--email', EMAIL, '--redefinir-senha', '--operador', 'alexandre', '--sem-mostrar-senha', '--confirmar'], 'estado: alterado');
    assert.equal(r.status, 0, r.saida);
    assert.equal(r.senha.length, 16);
    assert.ok(!r.saida.includes(r.senha), 'a senha apareceu na saída');
    assert.match(r.saida, /Nova senha provisória gravada e NÃO mostrada/);
  });

  it('falha do contêiner: nenhuma senha aparece', () => {
    const r = rodar(['criar-superadmin', '--email', EMAIL, '--operador', 'alexandre', '--sem-mostrar-senha', '--confirmar'], 'estado: desconhecido');
    assert.equal(r.status, 1);
    assert.ok(r.senha && !r.saida.includes(r.senha), 'a senha apareceu na saída');
  });

  it('sem --sem-mostrar-senha, o caminho de antes continua: a senha aparece uma vez no terminal', () => {
    const r = rodar(['criar-superadmin', '--email', EMAIL, '--operador', 'alexandre', '--confirmar'], 'estado: superadmin-criado');
    assert.equal(r.status, 0, r.saida);
    assert.equal(r.saida.split(r.senha).length - 1, 1);
  });

  it('--sem-mostrar-senha fora do criar e do --redefinir-senha é erro de uso (saída 2), sem chamar o contêiner', () => {
    const r = rodar(['superadmin', '--email', EMAIL, '--destravar', '--operador', 'alexandre', '--sem-mostrar-senha', '--confirmar'], 'estado: alterado');
    assert.equal(r.status, 2);
    assert.match(r.saida, /--sem-mostrar-senha só no criar-superadmin e no --redefinir-senha/);
    assert.equal(r.senha, '');
  });
});
