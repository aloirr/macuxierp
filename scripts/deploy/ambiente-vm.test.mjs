/**
 * `ambiente-vm.sh` (T-0024, T-0057 ADR 0014 §11): o gerados.env ganha os segredos gerados UMA vez, o pepper da entrada
 * incluído, sem regenerar na publicação seguinte e sem valor no log. Roda o script de verdade com MACUXIERP_DIR e
 * MACUXI_FDV_DIR em pastas temporárias (configuração do FDV fictícia) e o usuário atual como dono.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'producao', 'ambiente-vm.sh');
const pasta = mkdtempSync(join(tmpdir(), 'ambiente-vm-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

const erp = join(pasta, 'macuxierp');
const fdv = join(pasta, 'macuxi');
mkdirSync(erp, { recursive: true });
mkdirSync(fdv, { recursive: true });
writeFileSync(join(fdv, 'banco.env'), 'MACUXI_PG_HOST=banco.exemplo.invalid\nMACUXI_PG_PORTA=5432\n');
writeFileSync(join(fdv, 'admin.env'), 'MACUXI_PG_ADMIN_USUARIO=admin_ficticio\nMACUXI_PG_ADMIN_SENHA=senha-ficticia\n');
writeFileSync(join(fdv, 'segredos.env'), '');

function rodar() {
  const r = spawnSync('bash', [SCRIPT, userInfo().username], {
    env: { PATH: process.env.PATH, MACUXIERP_DIR: erp, MACUXI_FDV_DIR: fdv },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, saida: `${r.stdout}\n${r.stderr}` };
}
const gerados = () => readFileSync(join(erp, 'gerados.env'), 'utf8');
const valor = (texto, nome) => texto.match(new RegExp(`^${nome}=(.*)$`, 'm'))?.[1];

describe('ambiente-vm.sh: gerados.env (T-0057, pepper da entrada)', () => {
  it('gera o MACUXIERP_PEPPER_ENTRADA uma vez (64 hex), com os outros segredos, em 600 e sem o valor no log', () => {
    const r = rodar();
    assert.equal(r.status, 0, r.saida);
    const g = gerados();
    const pepper = valor(g, 'MACUXIERP_PEPPER_ENTRADA');
    assert.match(pepper ?? '', /^[0-9a-f]{64}$/);
    assert.match(valor(g, 'MACUXIERP_SEGREDO_BFF') ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(pepper, valor(g, 'MACUXIERP_SEGREDO_BFF'));
    assert.equal(statSync(join(erp, 'gerados.env')).mode & 0o777, 0o600);
    assert.match(r.saida, /gerado MACUXIERP_PEPPER_ENTRADA \(gerados\.env\)/);
    assert.ok(!r.saida.includes(pepper), 'o pepper apareceu no log');
  });

  it('a publicação seguinte não regenera nem duplica: o pepper continua o mesmo (trocar invalidaria as chaves)', () => {
    const antes = gerados();
    const r = rodar();
    assert.equal(r.status, 0, r.saida);
    assert.equal(gerados(), antes);
    assert.equal(gerados().match(/^MACUXIERP_PEPPER_ENTRADA=/gm)?.length, 1);
    assert.doesNotMatch(r.saida, /gerado MACUXIERP_PEPPER_ENTRADA/);
  });

  it('o compose passa o pepper só à api (obrigatório), e o env.modelo o documenta', () => {
    const compose = readFileSync(resolve(dirname(SCRIPT), '..', '..', '..', 'compose.yml'), 'utf8');
    const linhas = compose.split('\n').filter((l) => l.includes('MACUXIERP_PEPPER_ENTRADA:'));
    assert.equal(linhas.length, 1);
    assert.match(linhas[0], /\$\{MACUXIERP_PEPPER_ENTRADA:\?gerados\.env sem MACUXIERP_PEPPER_ENTRADA/);
    const api = compose.slice(compose.indexOf('macuxierp-api:'), compose.indexOf('macuxierp-worker:'));
    assert.ok(api.includes('MACUXIERP_PEPPER_ENTRADA:'), 'o pepper não está no serviço da api');
    assert.match(readFileSync(join(dirname(SCRIPT), 'env.modelo'), 'utf8'), /^MACUXIERP_PEPPER_ENTRADA=$/m);
  });

  it('sentinela: grava o nome (nunca o valor) de cada segredo gerado, em 600', () => {
    const sentinela = readFileSync(join(erp, '.chaves-geradas'), 'utf8').split('\n').filter(Boolean);
    for (const n of ['MACUXIERP_PEPPER_ENTRADA', 'MACUXIERP_SEGREDO_BFF', 'MACUXIERP_JWT_SEGREDO', 'MACUXIERP_CHAVE_A1', 'MACUXIERP_CHAVE_INTEGRACAO']) assert.ok(sentinela.includes(n), n);
    assert.ok(sentinela.every((l) => /^MACUXIERP_[A-Z0-9_]+$/.test(l)), 'a sentinela levou um valor');
    assert.equal(statSync(join(erp, '.chaves-geradas')).mode & 0o777, 0o600);
  });

  it('chave do .env que sumiu depois de gerada: PARA a publicação e não gera outra', () => {
    const envf = join(erp, '.env');
    const antes = readFileSync(envf, 'utf8');
    writeFileSync(envf, antes.replace(/^MACUXIERP_CHAVE_INTEGRACAO=.*\n/m, ''));
    const r = rodar();
    assert.equal(r.status, 1, r.saida);
    assert.match(r.saida, /MACUXIERP_CHAVE_INTEGRACAO já foi gerada nesta VM/);
    assert.doesNotMatch(readFileSync(envf, 'utf8'), /^MACUXIERP_CHAVE_INTEGRACAO=/m);
    writeFileSync(envf, antes);
    assert.equal(rodar().status, 0);
  });

  it('segredo do gerados.env que sumiu depois de gerado (o pepper): para também; sem a linha na sentinela, gera de propósito', () => {
    const antes = gerados();
    writeFileSync(join(erp, 'gerados.env'), antes.replace(/^MACUXIERP_PEPPER_ENTRADA=.*\n/m, ''));
    const r = rodar();
    assert.equal(r.status, 1, r.saida);
    assert.match(r.saida, /MACUXIERP_PEPPER_ENTRADA já foi gerada nesta VM/);
    // troca de propósito: apagar também na sentinela
    const s = join(erp, '.chaves-geradas');
    writeFileSync(s, readFileSync(s, 'utf8').replace(/^MACUXIERP_PEPPER_ENTRADA\n/m, ''));
    assert.equal(rodar().status, 0);
    assert.notEqual(valor(gerados(), 'MACUXIERP_PEPPER_ENTRADA'), valor(antes, 'MACUXIERP_PEPPER_ENTRADA'));
  });

  it('VM de antes da sentinela: na 1ª execução, os segredos que já existem entram na sentinela sem serem trocados', () => {
    const s = join(erp, '.chaves-geradas');
    rmSync(s);
    const g = gerados();
    assert.equal(rodar().status, 0);
    assert.equal(gerados(), g);
    assert.match(readFileSync(s, 'utf8'), /^MACUXIERP_CHAVE_A1$/m);
  });
});
