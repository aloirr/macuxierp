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
});
