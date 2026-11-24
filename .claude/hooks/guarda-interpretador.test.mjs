// Testes do guardião contra escrita por INTERPRETADOR e do caminho em WORKTREE (R-20261124-181828; decisão do
// Alexandre R-20261124-182330, opção A) — node:test, sem dependências.
// Rodar: node --test .claude/hooks/guarda-interpretador.test.mjs
// Parte 1: funções puras (guarda-interpretador-lib.mjs). Parte 2: analisarComando (guarda-bash-lib.mjs) com disco
// simulado. Parte 3: os hooks de verdade (guarda-donos.mjs e guarda-bash.mjs, stdin → exit code) num repositório
// git temporário com um worktree de verdade em .claude/worktrees/agent-x.
//
// Política (a): código inline de python/node/deno/bun/perl/ruby/php/lua (-c/-e, here-doc, here-string, pipe) com
// chamada que grava → o caminho literal resolvido segue as MESMAS regras de donos do > / tee / cp: dentro dos donos
// do agente passa (equivale ao Edit/Write dele), fora bloqueia. Caminho que não dá para determinar (argv, env,
// f-string, variável sem literal, chdir) ou código que executa outro processo → bloqueia ("use Edit/Write").
// Script em arquivo (node scripts/x.mjs, python3 -m mod) continua permitido: o alvo é o código inline.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { globParaRegex } from '../../scripts/coord-lib.mjs';
import { analisarComando, relativoNoWorktree, tokenizar, comandosSimples } from './guarda-bash-lib.mjs';
import { escritasDoCodigo, codigoInline, linguagemDe, escritasDoInterpretador } from './guarda-interpretador-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

const DONOS = {
  versao: 1,
  regras: [
    { padrao: '.claude/**', dono: 'alexandre' },
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: 'legado/**', dono: 'congelado' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: 'modules/cadastros/**', dono: 'modulo-cadastros' },
    { padrao: 'apps/web/**', dono: 'engenheiro-apps' },
    { padrao: 'apps/**', dono: 'engenheiro-software' },
    { padrao: '*', dono: 'engenheiro-software' },
  ],
  somente_leitura: [],
};
const REGRAS = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));

// ───────────────────────── Parte 1: funções puras ─────────────────────────

const args = (...v) => v.map((valor) => ({ valor, incerto: false }));
const alvosDe = (codigo, linguagem) => escritasDoCodigo(codigo, linguagem).alvos.map((a) => a.valor);

test('interpretador: linguagem pelo nome e onde está o código inline', () => {
  assert.equal(linguagemDe('/usr/bin/python3.12'), 'python');
  assert.equal(linguagemDe('node'), 'node');
  assert.equal(linguagemDe('tsx'), 'node');
  assert.equal(linguagemDe('cat'), null);
  assert.deepEqual(codigoInline('python', args('-c', 'print(1)')).codigos.map((c) => c.valor), ['print(1)']);
  assert.deepEqual(codigoInline('node', args('-e', 'x()')).codigos.map((c) => c.valor), ['x()']);
  assert.deepEqual(codigoInline('perl', args('-lne', 'print', 'a.txt')).codigos.map((c) => c.valor), ['print']);
  assert.deepEqual(codigoInline('python', args('-'), { heredocs: [{ corpo: 'open(1)', incerto: false }] }).codigos.map((c) => c.valor), ['open(1)']);
  // script em arquivo, módulo e --version não são código inline
  assert.equal(codigoInline('node', args('scripts/coord.mjs', 'caixa')), null);
  assert.equal(codigoInline('python', args('-m', 'json.tool')), null);
  assert.equal(codigoInline('python', args('tools/x.py'), { heredocs: [{ corpo: 'dados', incerto: false }] }), null);
  assert.equal(codigoInline('node', args('--version')), null);
  assert.equal(codigoInline('python', args(), { entradaArquivo: true }), null, 'python3 < script.py');
  assert.equal(codigoInline('python', args()), null, 'sem pipe nem here-doc: nada a executar');
  assert.ok(codigoInline('python', args(), { pipe: true, texto: 'echo x | python3' }), 'pipe: o comando inteiro é o código');
});

test('interpretador: tokenizador guarda o corpo do here-doc (literal com aspas no delimitador)', () => {
  const [cmd] = comandosSimples(tokenizar("python3 - <<'EOF'\nopen('a', 'w')\nEOF\n"));
  assert.deepEqual(cmd.heredocs, [{ corpo: "open('a', 'w')", incerto: false }]);
  const [cmd2] = comandosSimples(tokenizar('python3 - <<EOF\nopen("$X", "w")\nEOF\n'));
  assert.equal(cmd2.heredocs[0].incerto, true, 'delimitador sem aspas: $X é expandido pelo shell');
});

test('interpretador: chamadas que gravam por linguagem; leitura não conta', () => {
  assert.deepEqual(alvosDe("p = 'a/b.ts'\ns = open(p).read()\nopen(p, 'w').write(s)", 'python'), ['a/b.ts']);
  assert.deepEqual(alvosDe("open('a.txt', mode='a')", 'python'), ['a.txt']);
  assert.deepEqual(alvosDe("print(open('a.txt', 'rb').read())", 'python'), []);
  assert.deepEqual(alvosDe("from pathlib import Path\nR = Path('apps')\n(R / 'x.ts').write_text('1')", 'python'), ['apps/x.ts']);
  assert.deepEqual(alvosDe("import os, shutil\nos.remove('a')\nshutil.copy('b', 'c')\nshutil.rmtree('d')", 'python'), ['a', 'c', 'd']);
  assert.deepEqual(alvosDe("for p in ['m/a.ts', 'm/b.ts']:\n    open(p, 'w').write('x')", 'python'), ['m/a.ts', 'm/b.ts']);
  assert.deepEqual(alvosDe("s = 'texto'\nprint(s.replace('a', 'b'))\nl = []\nl.append('x')", 'python'), []);
  assert.deepEqual(alvosDe("require('fs').writeFileSync('a.ts', '')", 'node'), ['a.ts']);
  assert.deepEqual(alvosDe("import { appendFileSync } from 'node:fs'; appendFileSync(`b.ts`, 'x')", 'node'), ['b.ts']);
  assert.deepEqual(alvosDe("const fs = require('fs'); fs.renameSync('a', 'b'); fs.promises.rm('c', { recursive: true })", 'node'), ['a', 'b', 'c']);
  assert.deepEqual(alvosDe("process.stdout.write(require('fs').readFileSync('a.ts', 'utf8'))", 'node'), []);
  assert.deepEqual(alvosDe("const p = require('path').join('apps', 'web', 'x.ts'); require('fs').writeFileSync(p, '')", 'node'), ['apps/web/x.ts']);
  assert.deepEqual(alvosDe('open(my $fh, ">", "a.txt") or die; open(F, "<", "b.txt"); unlink "c.txt";', 'perl'), ['a.txt', 'c.txt']);
  assert.deepEqual(alvosDe("File.write('a.txt', 'x'); FileUtils.rm_rf 'tmp/b'", 'ruby'), ['a.txt', 'tmp/b']);
  assert.deepEqual(alvosDe("file_put_contents('a.txt', 'x');", 'php'), ['a.txt']);
});

test('interpretador: caminho que não dá para determinar ou execução de outro processo é indeterminado', () => {
  const ind = (codigo, linguagem) => escritasDoCodigo(codigo, linguagem).indeterminados;
  assert.equal(ind("import sys\nopen(sys.argv[1], 'w').write('x')", 'python').length, 1);
  assert.equal(ind("import os\nopen(os.environ['ALVO'], 'w')", 'python').length, 1);
  assert.equal(ind("n = 'x'\nopen(f'apps/{n}.ts', 'w')", 'python').length, 1);
  assert.equal(ind("import glob\nfor p in glob.glob('apps/**/*.ts'):\n    open(p, 'w')", 'python').length, 1);
  assert.equal(ind("import os\nos.chdir('apps')\nopen('x.ts', 'w')", 'python').length, 1);
  assert.equal(ind("import subprocess\nsubprocess.run(['sed', '-i', 's/a/b/', 'apps/x.ts'])", 'python').length, 1);
  assert.equal(ind("require('child_process').execSync('rm -rf apps')", 'node').length, 1);
  assert.equal(ind("require('fs').writeFileSync(process.argv[1], '')", 'node').length, 1);
  assert.equal(ind('system("rm -rf apps")', 'perl').length, 1);
  assert.deepEqual(ind("print(open('a.txt').read())", 'python'), [], 'só leitura: nada indeterminado');
  // código montado pelo shell ($VAR) com escrita
  const r = escritasDoInterpretador({ nome: 'python3', args: [{ valor: '-c', incerto: false }, { valor: "open('$ALVO', 'w')", incerto: true }] });
  assert.ok(r.indeterminados.some((m) => /\$VAR/.test(m)));
});

// ───────────────────────── Parte 2: analisarComando ─────────────────────────

const ARQUIVOS = ['modules/core/a.ts', 'modules/cadastros/b.ts', 'apps/api/x.ts', 'apps/web/a.ts'];
/** Disco simulado com o worktree .claude/worktrees/agent-x (.git dentro); agent-y não é worktree. */
function ambiente(raiz = '/repo') {
  const rel = (abs) => (abs.startsWith(`${raiz}/`) ? abs.slice(raiz.length + 1) : abs === raiz ? '' : null);
  return {
    existe: (abs) => { const r = rel(abs); return r !== null && (ARQUIVOS.includes(r) || r === '.claude/worktrees/agent-x/.git'); },
    ehDiretorio: () => false,
    sujos: () => [],
    rastreadosSob: (r) => ARQUIVOS.filter((f) => r === '' || f === r || f.startsWith(`${r}/`)),
    ler: () => null,
  };
}
const analisar = (comando, agente = 'modulo-core', cwd = '/repo') =>
  analisarComando({ comando, agente, cwd, raiz: '/repo', regras: REGRAS, amb: ambiente() });
const bloqueia = (cmd, agente, cwd) => {
  const r = analisar(cmd, agente, cwd);
  assert.ok(r.violacoes.length > 0, `deveria bloquear: ${cmd}`);
  return r.violacoes;
};
const libera = (cmd, agente, cwd) => {
  const r = analisar(cmd, agente, cwd);
  assert.deepEqual(r.violacoes, [], `deveria liberar: ${cmd}`);
  return r;
};

test('python heredoc escrevendo FORA dos donos: bloqueia (com o dono no motivo)', () => {
  const cmd = "python3 - <<'EOF'\np = 'apps/web/a.ts'\ns = open(p).read()\nopen(p, 'w').write(s.replace('a', 'b'))\nEOF";
  const v = bloqueia(cmd);
  assert.equal(v[0].rel, 'apps/web/a.ts');
  assert.match(v[0].motivo, /pertence a engenheiro-apps/);
  bloqueia("python3 <<EOF\nfor p in ['modules/core/a.ts', 'apps/api/x.ts']:\n    with open(p, 'w') as f:\n        f.write('x')\nEOF");
  bloqueia("python3 - <<'EOF'\nimport os\nos.remove('modules/cadastros/b.ts')\nEOF");
  bloqueia(`echo "open('apps/api/x.ts','w').write('x')" | python3`);
  bloqueia(`X=$(python3 -c "open('apps/api/x.ts','w')")`);
  bloqueia("bash <<'EOF'\necho x > apps/api/x.ts\nEOF");
  // governança: nem por interpretador
  bloqueia("python3 - <<'EOF'\nopen('.claude/hooks/guarda-donos.mjs', 'w').write('')\nEOF");
});

test('python escrevendo DENTRO dos donos: passa (mesma regra do Edit/Write e do > do agente)', () => {
  libera("python3 - <<'EOF'\np = 'modules/core/a.ts'\ns = open(p).read()\nopen(p, 'w').write(s.replace('a', 'b'))\nEOF");
  libera("python3 - <<EOF\nfor p in ['modules/core/a.ts', 'modules/core/b.ts']:\n    with open(p, 'w') as f:\n        f.write('x')\nEOF");
  libera("python3 - <<'EOF'\nfrom pathlib import Path\nR = Path('apps/web')\n(R / 'a.ts').write_text('x')\nEOF", 'engenheiro-apps');
  // escrita fora do repositório (temporário) não é de ninguém
  libera(`python3 -c "import tempfile,os; d=tempfile.mkdtemp(); open(os.path.join(d,'x'),'w')"`);
  libera(`python3 -c "open('/tmp/saida.json','w').write('{}')"`);
});

test('escrita por interpretador com caminho indeterminado: bloqueia com "use Edit/Write"', () => {
  const v = bloqueia("python3 - <<'EOF'\nimport sys\nopen(sys.argv[1], 'w').write('x')\nEOF");
  assert.match(v[0].motivo, /escrita por interpretador \(python3, código inline\)/);
  assert.match(v[0].motivo, /Use Edit\/Write/);
  bloqueia("python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['git', 'checkout', '--', 'apps'])\nEOF");
  bloqueia(`cd "$PASTA" && python3 -c "open('a.ts','w')"`, 'modulo-core');
  bloqueia(`pnpm --filter api exec node -e "require('fs').writeFileSync('x.ts','')"`, 'modulo-core');
  // vale também para o alexandre (o caminho pode ser congelado ou recado)
  bloqueia("python3 - <<'EOF'\nimport sys\nopen(sys.argv[1], 'w')\nEOF", 'alexandre');
});

test('node -e com writeFileSync FORA dos donos: bloqueia (também perl, ruby, npx tsx)', () => {
  const v = bloqueia(`node -e "require('fs').writeFileSync('apps/api/x.ts', '')"`);
  assert.equal(v[0].rel, 'apps/api/x.ts');
  assert.match(v[0].motivo, /pertence a engenheiro-software/);
  bloqueia(`node -e "const fs = require('fs'); fs.appendFileSync('modules/cadastros/b.ts', 'x')"`);
  bloqueia(`node --input-type=module <<'EOF'\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('apps/api/x.ts', '');\nEOF`);
  bloqueia(`npx tsx -e "import {writeFileSync} from 'node:fs'; writeFileSync('apps/api/x.ts','')"`);
  bloqueia(`perl -e 'open(my $fh, ">", "apps/api/x.ts") or die'`);
  bloqueia(`ruby -e 'File.write("apps/api/x.ts", "x")'`);
  libera(`node -e "const fs=require('fs'); fs.writeFileSync('modules/core/x.ts', fs.readFileSync('apps/api/x.ts'))"`);
});

test('leitura por python, node ou cat: passa; script em arquivo continua permitido', () => {
  libera(`python3 -c "import json; print(json.load(open('apps/api/x.json'))['a'])"`);
  libera("python3 - <<'EOF'\ntexto = open('apps/api/x.ts').read()\nprint(texto.replace('a', 'b'))\nEOF");
  libera(`cat apps/api/x.ts | python3 -c 'import sys; print(len(sys.stdin.read()))'`);
  libera(`node -e "process.stdout.write(require('fs').readFileSync('apps/api/x.ts', 'utf8'))"`);
  libera(`node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=7)?0:1)'`);
  libera('cat apps/web/a.ts && head -5 apps/api/x.ts');
  libera(`perl -ne 'print if /x/' apps/api/x.ts`);
  libera('node scripts/coord.mjs caixa modulo-core');
  libera('node --test .claude/hooks/*.test.mjs');
  libera('python3 -m json.tool apps/api/x.json');
});

test('worktree (.claude/worktrees/<nome>/...): vale o caminho a partir do topo do worktree', () => {
  const eh = (r, nome) => nome === 'agent-x';
  assert.equal(relativoNoWorktree('.claude/worktrees/agent-x/apps/web/a.ts', '/repo', eh), 'apps/web/a.ts');
  assert.equal(relativoNoWorktree('.claude/worktrees/agent-x/.claude/hooks/y.mjs', '/repo', eh), '.claude/hooks/y.mjs');
  assert.equal(relativoNoWorktree('.claude/worktrees/agent-x', '/repo', eh), '.claude/worktrees/agent-x', 'a pasta do worktree em si');
  assert.equal(relativoNoWorktree('.claude/worktrees/agent-y/apps/web/a.ts', '/repo', eh), '.claude/worktrees/agent-y/apps/web/a.ts', 'sem .git: não é worktree');
  assert.equal(relativoNoWorktree(null, '/repo', eh), null);
  // Bash: dono do apps/web passa no worktree; .claude/hooks do worktree continua só do alexandre
  libera('echo x > .claude/worktrees/agent-x/apps/web/a.ts', 'engenheiro-apps');
  libera("cd .claude/worktrees/agent-x && python3 -c \"open('apps/web/a.ts','w')\"", 'engenheiro-apps');
  const v = bloqueia('echo x > .claude/worktrees/agent-x/.claude/hooks/y.mjs', 'engenheiro-apps');
  assert.match(v[0].motivo, /pertence a alexandre/);
  bloqueia('echo x > .claude/worktrees/agent-x/apps/api/x.ts', 'engenheiro-apps');
  bloqueia('echo x > .claude/worktrees/agent-y/apps/web/a.ts', 'engenheiro-apps');
  bloqueia('rm -rf .claude/worktrees/agent-x', 'engenheiro-apps');
  libera('echo x > .claude/worktrees/agent-x/.claude/hooks/y.mjs', 'alexandre');
});

// ───────────────────────── Parte 3: hooks de verdade com worktree real ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function escrever(dir, rel, conteudo = 'x\n') {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}

/** Repositório com os hooks e um worktree de verdade em .claude/worktrees/agent-x. */
function criarRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-interp-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }, null, 2));
  for (const f of ARQUIVOS) escrever(dir, f);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  for (const f of ['guarda-donos.mjs', 'guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-interpretador-lib.mjs', 'guarda-merge-lib.mjs', 'guarda-graphify-lib.mjs']) {
    escrever(dir, `.claude/hooks/${f}`, readFileSync(join(AQUI, f), 'utf8'));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial');
  git(dir, 'worktree', 'add', '-q', '-b', 'agente/x', join(dir, '.claude', 'worktrees', 'agent-x'));
  return dir;
}
function rodarHook(dir, hook, toolInput, agente) {
  const base = { ...process.env };
  delete base.MACUXI_AGENTE;
  delete base.CLAUDE_CODE_REMOTE;
  const json = {
    session_id: 's-interp', tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse',
    tool_name: hook === 'guarda-bash.mjs' ? 'Bash' : 'Write', tool_input: toolInput, cwd: dir,
  };
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', hook)], {
    cwd: dir, input: JSON.stringify(json), encoding: 'utf8', env: { ...base, MACUXI_GUARDA: '', MACUXI_AGENTE: agente },
  });
  return { codigo: r.status, erro: r.stderr };
}
const editar = (dir, rel, agente) => rodarHook(dir, 'guarda-donos.mjs', { file_path: join(dir, rel), content: 'x' }, agente);
const bash = (dir, command, agente) => rodarHook(dir, 'guarda-bash.mjs', { command }, agente);

test('hook (Edit/Write): worktree com apps/web para o dono do apps passa; .claude/hooks do worktree barra quem não é alexandre', () => {
  const dir = criarRepo();
  const ok = editar(dir, '.claude/worktrees/agent-x/apps/web/a.ts', 'engenheiro-apps');
  assert.equal(ok.codigo, 0, ok.erro);
  const gov = editar(dir, '.claude/worktrees/agent-x/.claude/hooks/y.mjs', 'engenheiro-apps');
  assert.equal(gov.codigo, 2);
  assert.match(gov.erro, /"\.claude\/hooks\/y\.mjs" pertence a alexandre/);
  assert.equal(editar(dir, '.claude/worktrees/agent-x/apps/api/x.ts', 'engenheiro-apps').codigo, 2, 'apps/api é de outro dono');
  assert.equal(editar(dir, '.claude/worktrees/agent-y/apps/web/a.ts', 'engenheiro-apps').codigo, 2, 'pasta sem worktree continua .claude/**');
  assert.equal(editar(dir, '.claude/worktrees/agent-x/.claude/hooks/y.mjs', 'alexandre').codigo, 0);
});

test('hook (Bash): worktree e escrita por interpretador de ponta a ponta', () => {
  const dir = criarRepo();
  const ok = bash(dir, 'echo x > .claude/worktrees/agent-x/apps/web/a.ts', 'engenheiro-apps');
  assert.equal(ok.codigo, 0, ok.erro);
  assert.equal(bash(dir, 'echo x > .claude/worktrees/agent-x/.claude/hooks/y.mjs', 'engenheiro-apps').codigo, 2);
  const py = bash(dir, "python3 - <<'EOF'\nopen('apps/web/a.ts', 'w').write('x')\nEOF", 'modulo-core');
  assert.equal(py.codigo, 2);
  assert.match(py.erro, /BLOQUEADO \(Bash\)/);
  assert.match(py.erro, /"apps\/web\/a\.ts" pertence a engenheiro-apps/);
  const dono = bash(dir, "python3 - <<'EOF'\nopen('modules/core/a.ts', 'w').write('x')\nEOF", 'modulo-core');
  assert.equal(dono.codigo, 0, dono.erro);
  const js = bash(dir, `node -e "require('fs').writeFileSync('apps/api/x.ts', '')"`, 'modulo-core');
  assert.equal(js.codigo, 2);
  const ind = bash(dir, "python3 - <<'EOF'\nimport sys\nopen(sys.argv[1], 'w')\nEOF", 'modulo-core');
  assert.equal(ind.codigo, 2);
  assert.match(ind.erro, /Use Edit\/Write/);
  // leitura por python passa (cat/head de código ficam com a trava do graphify, que não é deste teste)
  const ler = bash(dir, `python3 -c "print(open('apps/api/x.ts').read())"`, 'modulo-core');
  assert.equal(ler.codigo, 0, ler.erro);
});
