// Testes da chave do host de produção (v0.3.31; decisão do PO, opção c): sem known_hosts versionado, a impressão digital
// fixada no .github/scripts/chave-host.sh, HostKeyAlias nos dois workflows e nada do host no log, no resumo nem no repositório.
//
// O script roda de verdade (bash). O ssh-keygen é o do sistema quando existe; sem ele, um stub no PATH imprime a impressão
// digital calculada em Node (SHA-256 do blob, base64 sem "=", o formato do ssh-keygen -lf). O caso "igual" roda uma cópia do
// script com a ESPERADA trocada pela da chave gerada aqui (a chave da VM não está no repositório, de propósito).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = (p = '') => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const ler = (p) => readFileSync(raiz(p), 'utf8');
const SCRIPT = raiz('.github/scripts/chave-host.sh');
const TEXTO_SCRIPT = ler('.github/scripts/chave-host.sh');
const WORKFLOWS = ['producao-publicar', 'producao-diagnostico'];
const HOST_FICTICIO = 'vm-ficticia.exemplo.invalid';
const ESPERADA = /^ESPERADA='(SHA256:[A-Za-z0-9+/]{43})'$/m.exec(TEXTO_SCRIPT)?.[1];

// blob OpenSSH da chave pública ed25519: string "ssh-ed25519" + string com os 32 bytes da chave
function chaveEd25519() {
  const { publicKey } = generateKeyPairSync('ed25519');
  const bruta = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const str = (b) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(b.length);
    return Buffer.concat([n, b]);
  };
  return Buffer.concat([str(Buffer.from('ssh-ed25519')), str(bruta)]).toString('base64');
}
const digital = (b64) => `SHA256:${createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '')}`;

const temSshKeygen = (process.env.PATH ?? '').split(delimiter).some((d) => d && existsSync(join(d, 'ssh-keygen')));
const PATH_TESTE = (() => {
  if (temSshKeygen) return process.env.PATH;
  const dir = mkdtempSync(join(tmpdir(), 'chave-host-stub-'));
  const stub = join(dir, 'ssh-keygen');
  writeFileSync(
    stub,
    `#!${process.execPath}
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const i = process.argv.indexOf('-lf');
if (i < 0) process.exit(2);
for (const l of readFileSync(process.argv[i + 1], 'utf8').split('\\n').filter(Boolean)) {
  const [nome, tipo, b64] = l.split(' ');
  const d = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');
  console.log('256 SHA256:' + d + ' ' + nome + ' (' + tipo.replace('ssh-', '').toUpperCase() + ')');
}
`,
  );
  chmodSync(stub, 0o755);
  return `${dir}${delimiter}${process.env.PATH}`;
})();

// script com outra esperada (só para provar o caso "igual" sem a chave da VM)
const scriptCom = (esperada) => {
  const p = join(mkdtempSync(join(tmpdir(), 'chave-host-sh-')), 'chave-host.sh');
  writeFileSync(p, TEXTO_SCRIPT.replace(`ESPERADA='${ESPERADA}'`, `ESPERADA='${esperada}'`));
  return p;
};

function rodar(entrada, { script = SCRIPT, fonte = 'teste' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chave-host-'));
  const arq = join(dir, 'entrada');
  const destino = join(dir, 'known_hosts');
  const resumo = join(dir, 'resumo.md');
  writeFileSync(arq, entrada);
  writeFileSync(resumo, '');
  const r = spawnSync('bash', [script, arq, fonte, destino], {
    encoding: 'utf8',
    env: { PATH: PATH_TESTE, HOME: process.env.HOME, GITHUB_STEP_SUMMARY: resumo },
  });
  const known = existsSync(destino) ? readFileSync(destino, 'utf8') : null;
  const saida = r.stdout + r.stderr + readFileSync(resumo, 'utf8');
  assert.ok(!saida.includes(HOST_FICTICIO), 'nada do host no log nem no resumo');
  return { status: r.status, stdout: r.stdout, saida, known };
}

// entrada como a do ssh-keyscan ou do secret: comentário, host em claro, host em hash, outro tipo, \r
const entradaCom = (...chaves) =>
  [
    `# ${HOST_FICTICIO}:22 SSH-2.0-OpenSSH_9.6`,
    ...chaves.flatMap((c) => [`${HOST_FICTICIO} ssh-ed25519 ${c}\r`, `|1|Zm9v|YmFy ssh-ed25519 ${c} comentario`]),
    `${HOST_FICTICIO} ssh-rsa AAAAB3NzaC1yc2E`,
    `@cert-authority ${HOST_FICTICIO} ssh-ed25519 ${chaveEd25519()}`,
    '',
  ].join('\n');

test(`ssh-keygen ${temSshKeygen ? 'do sistema' : 'stub em Node (ssh-keygen não instalado)'}; esperada lida do script`, () => {
  assert.ok(ESPERADA, 'ESPERADA no formato SHA256:<43> no chave-host.sh');
});

test('igual: passa e grava o known_hosts só com "macuxierp-prod ssh-ed25519 <base64>"', () => {
  const a = chaveEd25519();
  const r = rodar(entradaCom(a), { script: scriptCom(digital(a)) });
  assert.equal(r.status, 0, r.saida);
  assert.equal(r.known, `macuxierp-prod ssh-ed25519 ${a}\n`);
  assert.match(r.saida, new RegExp(`${digital(a).replace(/[+/]/g, '\\$&')}\`?: a conferida na VM`));
});

test('diferente: exit≠0, ::error:: e known_hosts não gravado (script real, esperada da VM)', () => {
  const r = rodar(entradaCom(chaveEd25519()));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /^::error::chave do host \(teste\): impressão digital SHA256:\S+ não é a conferida na VM/m);
  assert.equal(r.known, null);
});

test('vazia: exit≠0 sem nenhuma ssh-ed25519 (vazio, só comentário, só outro tipo)', () => {
  for (const e of ['', `# ${HOST_FICTICIO}:22 SSH-2.0\n`, `${HOST_FICTICIO} ssh-rsa AAAAB3NzaC1yc2E\n`]) {
    const r = rodar(e);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /::error::chave do host \(teste\): nenhuma chave ssh-ed25519/);
    assert.equal(r.known, null);
  }
});

test('duas chaves distintas: exit≠0 mesmo com uma delas igual à esperada', () => {
  const a = chaveEd25519();
  const r = rodar(entradaCom(a, chaveEd25519()), { script: scriptCom(digital(a)) });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error::chave do host \(teste\): duas ou mais chaves ssh-ed25519 distintas/);
  assert.equal(r.known, null);
});

test('uso errado sai 2', () => {
  assert.equal(spawnSync('bash', [SCRIPT, 'x'], { encoding: 'utf8' }).status, 2);
});

test('workflows: secret ou ssh-keyscan, script antes do primeiro ssh/scp, HostKeyAlias/HostKeyAlgorithms/StrictHostKeyChecking', () => {
  for (const wf of WORKFLOWS) {
    const txt = ler(`.github/workflows/${wf}.yml`);
    const linhas = txt.split('\n');
    const idx = (re) => linhas.findIndex((l) => re.test(l));
    const script = idx(/^ {10}bash \.github\/scripts\/chave-host\.sh "\$RUNNER_TEMP\/chave-host" "\$fonte" ~\/\.ssh\/known_hosts$/);
    assert.ok(script > 0, `${wf}: chama o script`);
    const primeiroSsh = idx(/(^\s+|[|&;(]\s*)(ssh|scp) |email-env\.sh enviar/);
    assert.ok(primeiroSsh > script, `${wf}: script (linha ${script + 1}) antes do primeiro ssh/scp (linha ${primeiroSsh + 1})`);
    assert.ok(idx(/^ {10}if \[ -n "\$CONHECIDOS" \]; then$/) < script && idx(/ssh-keyscan -T 15 -t ed25519 "\$HOST"/) < script, wf);
    const config = linhas.find((l) => l.includes("printf 'Host prod\\n"));
    for (const o of ['HostKeyAlias macuxierp-prod', 'HostKeyAlgorithms ssh-ed25519', 'StrictHostKeyChecking yes', 'CheckHostIP no', 'UpdateHostKeys no']) {
      assert.ok(config?.includes(`\\n  ${o}\\n`), `${wf}: ${o}`);
    }
    assert.ok(idx(/printf 'Host prod\\n/) > script, `${wf}: ~/.ssh/config depois da conferência`);
    for (const fora of ['.github/producao', 'actions/cache', 'TOFU', 'macuxierp-prod-known-hosts']) assert.ok(!txt.includes(fora), `${wf}: ${fora}`);
    const esparso = txt.slice(txt.indexOf('sparse-checkout: |'), txt.indexOf('\n\n', txt.indexOf('sparse-checkout: |')));
    assert.match(esparso, /^\s+\.github\/scripts$/m, `${wf}: checkout traz o script`);
  }
});

test('nada que escreve no log ou no resumo do job cita o host', () => {
  const codigo = TEXTO_SCRIPT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(codigo, /HOST/, 'o script não recebe nem lê o host');
  assert.doesNotMatch(TEXTO_SCRIPT, /^\s*set\s+(-\w*x|-o\s+xtrace)/m);
  for (const wf of WORKFLOWS) {
    const txt = ler(`.github/workflows/${wf}.yml`);
    assert.doesNotMatch(txt, /^\s*set\s+(-\w*x|-o\s+xtrace)/m, wf);
    assert.doesNotMatch(txt, /\$\{?PROD_HOST\b/, `${wf}: o valor do PROD_HOST só chega como $HOST`);
    const linhas = txt.split('\n');
    linhas.forEach((l, i) => {
      const onde = `${wf}:${i + 1}`;
      if (l.includes('secrets.PROD_HOST')) assert.match(l, /^\s+(PROD_)?HOST: \$\{\{ secrets\.PROD_HOST \}\}$/, onde);
      // $HOST só no ssh-keyscan (stderr descartado, saída num arquivo que o script reescreve) e no ~/.ssh/config
      if (/\$\{?HOST\b/.test(l)) {
        assert.ok(
          /^\s+ssh-keyscan -T 15 -t ed25519 "\$HOST" 2>\/dev\/null > "\$RUNNER_TEMP\/chave-host" \|\| true$/.test(l) ||
            /^\s+printf 'Host prod\\n[^']*' "\$HOST" > ~\/\.ssh\/config$/.test(l),
          onde,
        );
      }
      if (/::(error|warning|notice)::|\becho\b/.test(l)) assert.doesNotMatch(l, /PROD_HOST|\$\{?HOST\b/, onde);
      if (!l.includes('GITHUB_STEP_SUMMARY')) return;
      let j = i;
      if (/^\s*\}/.test(l)) while (j > 0 && !/^\s*\{\s*$/.test(linhas[j])) j--;
      assert.doesNotMatch(linhas.slice(j, i + 1).join('\n'), /PROD_HOST|\$\{?HOST\b/, onde);
    });
  }
});

// arquivos do deploy (fora o .git e dependências)
function arquivos(dir) {
  const base = raiz(dir);
  if (!existsSync(base)) return [];
  if (statSync(base).isFile()) return [dir];
  return readdirSync(base, { recursive: true })
    .map((p) => join(dir, String(p)))
    .filter((p) => !p.includes('node_modules') && statSync(raiz(p)).isFile());
}

test('nenhum IP no deploy (.github, scripts/deploy, compose.yml), fora 127.0.0.1 e 0.0.0.0', () => {
  const achados = [];
  for (const p of ['.github', 'scripts/deploy', 'compose.yml'].flatMap(arquivos)) {
    for (const m of ler(p).matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      if (m[0] !== '127.0.0.1' && m[0] !== '0.0.0.0') achados.push(`${p}: ${m[0]}`);
    }
  }
  assert.deepEqual(achados, []);
});

test('a impressão digital esperada aparece em um lugar só do repositório (o chave-host.sh)', () => {
  // --untracked: também os arquivos ainda não rastreados (fora os do .gitignore)
  const r = spawnSync('git', ['grep', '-l', '-F', '--untracked', ESPERADA], { cwd: raiz(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['.github/scripts/chave-host.sh']);
});
