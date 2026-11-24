// T-0076: email.env da produção. node --test scripts/deploy/email-env.test.mjs
// Cobre o email-env.sh (monta o arquivo no runner a partir dos PROD_SMTP_*; resumo e log sem valor), o compose.yml
// (email.env só na api e no worker, required: false) e o producao-publicar.yml (secrets só no env:, arquivo pelo stdin).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const raiz = new URL('../../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, raiz), 'utf8');
const SCRIPT = new URL('scripts/deploy/producao/email-env.sh', raiz).pathname;

const COMPLETO = {
  PROD_SMTP_HOST: 'smtp.exemplo.invalid',
  PROD_SMTP_PORTA: '587',
  PROD_SMTP_TLS: 'starttls',
  PROD_SMTP_USUARIO: 'usuario-falso@exemplo.invalid',
  PROD_SMTP_SENHA: 'senha-falsa-$HOME-#1',
  PROD_SMTP_REMETENTE: 'Macuxi ERP <nao-responda@exemplo.invalid>',
};

function rodar(secrets) {
  const dir = mkdtempSync(join(tmpdir(), 'email-env-'));
  const resumo = join(dir, 'resumo.md');
  writeFileSync(resumo, '');
  const saida = join(dir, 'email.env');
  const env = { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: resumo, ...secrets };
  const r = spawnSync('bash', [SCRIPT, saida], { env, encoding: 'utf8' });
  const res = {
    codigo: r.status,
    log: `${r.stdout}${r.stderr}`,
    resumo: readFileSync(resumo, 'utf8'),
    arquivo: readFileSync(saida, 'utf8'),
    modo: (statSync(saida).mode & 0o777).toString(8),
  };
  rmSync(dir, { recursive: true, force: true });
  return res;
}

const semMascara = (log) =>
  log
    .split('\n')
    .filter((l) => !l.startsWith('::add-mask::'))
    .join('\n');

function semValor(res, secrets) {
  for (const [nome, v] of Object.entries(secrets)) {
    if (!v || ['587', 'starttls', 'tls'].includes(v)) continue;
    assert.ok(!res.resumo.includes(v), `valor de ${nome} no resumo`);
    assert.ok(!semMascara(res.log).includes(v), `valor de ${nome} no log`);
  }
  // o resumo só cita a porta e o TLS pelo nome
  assert.ok(!/\b587\b|starttls/.test(res.resumo), 'porta ou TLS no resumo');
}

test('os 6 secrets: smtp, valores entre aspas simples, 600, resumo e log sem valor', () => {
  const r = rodar(COMPLETO);
  assert.equal(r.codigo, 0);
  assert.equal(r.modo, '600');
  const linhas = r.arquivo.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(linhas, [
    'MACUXI_EMAIL_TRANSPORTE=smtp',
    "MACUXI_SMTP_HOST='smtp.exemplo.invalid'",
    "MACUXI_SMTP_PORTA='587'",
    "MACUXI_SMTP_TLS='starttls'",
    "MACUXI_SMTP_USUARIO='usuario-falso@exemplo.invalid'",
    "MACUXI_SMTP_SENHA='senha-falsa-$HOME-#1'",
    "MACUXI_SMTP_REMETENTE='Macuxi ERP <nao-responda@exemplo.invalid>'",
  ]);
  assert.match(r.resumo, /Os 6 secrets PROD_SMTP_\* estão/);
  assert.match(r.log, /^::add-mask::senha-falsa-\$HOME-#1$/m);
  semValor(r, COMPLETO);
});

test('sem PROD_SMTP_HOST: desligado, sem MACUXI_SMTP_*, resumo com os nomes que faltam, job não falha', () => {
  const s = { ...COMPLETO, PROD_SMTP_HOST: '', PROD_SMTP_TLS: '' };
  const r = rodar(s);
  assert.equal(r.codigo, 0);
  assert.match(r.arquivo, /^MACUXI_EMAIL_TRANSPORTE=desligado$/m);
  assert.doesNotMatch(r.arquivo, /MACUXI_SMTP_/);
  assert.match(r.resumo, /ausentes no environment PRODUCAO \(só os nomes\): PROD_SMTP_HOST PROD_SMTP_TLS\./);
  semValor(r, s);
});

test('nenhum secret: desligado e os 6 nomes no resumo', () => {
  const r = rodar({});
  assert.equal(r.codigo, 0);
  assert.equal(r.modo, '600');
  assert.match(r.arquivo, /^MACUXI_EMAIL_TRANSPORTE=desligado$/m);
  assert.match(
    r.resumo,
    /PROD_SMTP_HOST PROD_SMTP_PORTA PROD_SMTP_TLS PROD_SMTP_USUARIO PROD_SMTP_SENHA PROD_SMTP_REMETENTE\./,
  );
});

test('com HOST, USUARIO e SENHA são obrigatórios: sem a senha, desligado com aviso pelo nome', () => {
  const s = { ...COMPLETO, PROD_SMTP_SENHA: '' };
  const r = rodar(s);
  assert.equal(r.codigo, 0);
  assert.match(r.arquivo, /^MACUXI_EMAIL_TRANSPORTE=desligado$/m);
  assert.doesNotMatch(r.arquivo, /MACUXI_SMTP_/);
  assert.match(r.log, /::warning::e-mail desligado: PROD_SMTP_SENHA ausente/);
  semValor(r, s);
});

test('formato: TLS, porta, aspa simples e quebra de linha desligam o e-mail sem mostrar o valor', () => {
  for (const [nome, v] of [
    ['PROD_SMTP_TLS', 'ssl'],
    ['PROD_SMTP_PORTA', '70000'],
    ['PROD_SMTP_SENHA', "abc'def"],
    ['PROD_SMTP_SENHA', 'linha1\nMACUXI_EMAIL_TRANSPORTE=smtp'],
  ]) {
    const s = { ...COMPLETO, [nome]: v };
    const r = rodar(s);
    assert.equal(r.codigo, 0, nome);
    assert.match(r.arquivo, /^MACUXI_EMAIL_TRANSPORTE=desligado$/m, `${nome}=${JSON.stringify(v)}`);
    assert.doesNotMatch(r.arquivo, /MACUXI_SMTP_|=smtp/);
    assert.match(r.log, new RegExp(`::warning::e-mail desligado: ${nome}`));
    assert.ok(!r.resumo.includes(v) && !semMascara(r.log).includes(v), `${nome}: valor exposto`);
  }
});

test('\\r e quebra de linha no fim (colado pelo celular) são tirados', () => {
  const r = rodar({ ...COMPLETO, PROD_SMTP_HOST: 'smtp.exemplo.invalid\r\n' });
  assert.match(r.arquivo, /^MACUXI_EMAIL_TRANSPORTE=smtp$/m);
  assert.match(r.arquivo, /^MACUXI_SMTP_HOST='smtp\.exemplo\.invalid'$/m);
});

test('compose.yml: email.env só na api e no worker (x-app), com required: false', () => {
  const c = ler('compose.yml');
  const codigo = c
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  assert.equal(codigo.match(/email\.env/g)?.length, 1, 'email.env citado uma vez só (âncora x-app)');
  const xApp = codigo.match(/^x-app: &app\n((?: {2}.*\n)+)/m)?.[1] ?? '';
  assert.match(xApp, /- path: email\.env\n\s+required: false/);
  const servicos = codigo.slice(codigo.indexOf('\nservices:\n'));
  const usaApp = [...servicos.matchAll(/^ {2}([a-z0-9-]+):\n {4}<<: \*app$/gm)].map((m) => m[1]);
  assert.deepEqual(usaApp.sort(), ['macuxierp-api', 'macuxierp-worker']);
  assert.equal((codigo.match(/\*app\b/g) ?? []).length, 2, '*app só na api e no worker');
});

test('producao-publicar.yml: PROD_SMTP_* só no env: do passo, arquivo pelo stdin do ssh e apagado', () => {
  const w = ler('.github/workflows/producao-publicar.yml');
  const usos = w.split('\n').filter((l) => l.includes('secrets.PROD_SMTP_'));
  assert.equal(usos.length, 6);
  for (const l of usos) assert.match(l, /^ {10}PROD_SMTP_([A-Z]+): \$\{\{ secrets\.PROD_SMTP_\1 \}\}$/);
  assert.match(w, /run: bash scripts\/deploy\/producao\/email-env\.sh "\$RUNNER_TEMP\/email\.env"/);
  assert.match(w, /'umask 077 && cat > ~\/macuxierp-deploy\/email\.env' < "\$RUNNER_TEMP\/email\.env"/);
  assert.match(w, /rm -rf [^\n]*"\$RUNNER_TEMP\/email\.env"/);
  // o email.env sobe antes do preparar-vm.sh (que chama o ambiente-vm.sh, que o instala)
  assert.ok(w.indexOf('cat > ~/macuxierp-deploy/email.env') < w.indexOf('preparar-vm.sh "$USER"'));
});
