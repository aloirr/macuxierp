// Testes da trava do graphify (T-0064, R-20261123-164322; regra R-20261122-035710).
// Rodar: node --test .claude/hooks/guarda-graphify.test.mjs
// Parte 1: funções puras (guarda-graphify-lib.mjs) com repositórios simulados.
// Parte 2: os hooks de verdade (guarda-graphify.mjs para Read/Grep e guarda-bash.mjs para Bash, stdin → exit code)
// em repositórios git temporários: ERP (+ worktree) e clone do FDV; um caso por caminho.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  MENSAGEM_ERP, MENSAGEM_TRECHO, mensagemFdv, tipoPorRemotes, classificar, caminhosDoLeitor, analisarBash,
  decidirRead, decidirGrep, globSoMarkdown,
} from './guarda-graphify-lib.mjs';
import { tokenizar, comandosSimples } from './guarda-bash-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

// ───────────────────────────── Parte 1: puras ─────────────────────────────

const ERP = '/w/erp';
const WT = '/w/erp-wt';
const FDV = '/w/fdv';
const REC = '/w/recados';
/** repoDe simulado: ERP (principal e worktree), FDV, recados; o resto fora de repo. */
const repoDe = (abs) => {
  for (const [top, tipo] of [[ERP, 'erp'], [WT, 'erp'], [FDV, 'fdv'], [REC, 'recados']]) {
    if (abs === top || abs.startsWith(`${top}/`)) return { top, tipo };
  }
  return null;
};
const SEM = { erp: false, fdv: false };
const SO_ERP = { erp: true, fdv: false };
const SO_FDV = { erp: false, fdv: true };
const bash = (comando, marcas = SEM, cwd = ERP) => analisarBash({ comando, cwd, marcas, repoDe });

test('mensagem de bloqueio exata do ERP; a do FDV cita as duas ações', () => {
  assert.equal(MENSAGEM_ERP, 'Consulte o graphify antes: graphify explain "<símbolo>" ou leia graphify-out/GRAPH_REPORT.md (R-20261122-035710)');
  const f = mensagemFdv('/w/fdv');
  assert.ok(f.includes('cd /w/fdv && graphify update .'), f);
  assert.ok(f.includes('graphify query "<pergunta>" --graph /w/fdv/graphify-out/graph.json --budget 1500'), f);
  assert.equal(MENSAGEM_TRECHO, 'leia só o trecho: use offset e limit');
});

test('tipoPorRemotes: FDV, recados e ERP pelo remote (https, ssh, com e sem .git)', () => {
  assert.equal(tipoPorRemotes(['https://github.com/aloirr/macuxifdv.git']), 'fdv');
  assert.equal(tipoPorRemotes(['git@github.com:aloirr/macuxifdv']), 'fdv');
  assert.equal(tipoPorRemotes(['http://127.0.0.1:1234/git/aloirr/macuxifdv/']), 'fdv');
  assert.equal(tipoPorRemotes(['https://github.com/aloirr/macuxierp-recados.git']), 'recados');
  assert.equal(tipoPorRemotes(['https://github.com/aloirr/macuxierp.git']), 'erp');
  assert.equal(tipoPorRemotes(['https://github.com/outro/macuxifdv-fork.git']), null);
  assert.equal(tipoPorRemotes([]), null);
});

test('classificar: código do ERP, FDV e livres (docs, .md, .coord, graphify-out, recados, fora de repo)', () => {
  for (const p of ['modules/core/a.ts', 'apps/api/src/app.ts', 'packages/platform-sdk/x.ts', 'db/m/1.sql', 'scripts/coord.mjs', 'tests/a.test.ts', '.github/workflows/ci.yml']) {
    assert.equal(classificar(`${ERP}/${p}`, repoDe).tipo, 'erp', p);
    assert.equal(classificar(`${WT}/${p}`, repoDe).tipo, 'erp', `worktree ${p}`);
  }
  assert.equal(classificar(ERP, repoDe).tipo, 'erp', 'a raiz contém o código');
  for (const p of ['docs/produto/01.md', 'docs/a.png', 'modules/core/LEIA.md', '.coord/quadro.md', '.coord/donos.json', 'graphify-out/graph.json', 'package.json', '.claude/settings.json']) {
    assert.equal(classificar(`${ERP}/${p}`, repoDe).tipo, 'livre', p);
  }
  assert.equal(classificar(`${REC}/recados/gerente/R-1.json`, repoDe).tipo, 'livre');
  assert.equal(classificar('/etc/passwd', repoDe).tipo, 'livre');
  assert.equal(classificar(`${FDV}/app/src/Main.kt`, repoDe).tipo, 'fdv');
  assert.equal(classificar(`${FDV}/package.json`, repoDe).tipo, 'fdv');
  assert.equal(classificar(`${FDV}/README.md`, repoDe).tipo, 'livre');
});

test('caminhosDoLeitor: padrão/script não é caminho; -e/-f fazem tudo ser caminho', () => {
  const arq = (cmd) => {
    const [c] = comandosSimples(tokenizar(cmd));
    const r = caminhosDoLeitor(c.palavras[0].valor, c.palavras.slice(1));
    return { arquivos: r.arquivos.map((a) => a.valor), recursivo: r.recursivo };
  };
  assert.deepEqual(arq('grep -rn "modules/core" docs').arquivos, ['docs']);
  assert.deepEqual(arq('grep -A 3 -e foo apps/x.ts').arquivos, ['apps/x.ts']);
  assert.deepEqual(arq("sed -n '1,20p' db/a.sql").arquivos, ['db/a.sql']);
  assert.deepEqual(arq("awk -F: '{print $1}' scripts/a.mjs").arquivos, ['scripts/a.mjs']);
  assert.deepEqual(arq('head -n 5 tests/a.ts').arquivos, ['tests/a.ts']);
  assert.deepEqual(arq('rg -g "*.ts" foo').recursivo, true);
  assert.deepEqual(arq('grep -rn foo').recursivo, true);
  assert.deepEqual(arq('grep foo').recursivo, false);
});

test('Bash sem marca: leitura de código bloqueia (simples, pipeline, composto, $(...), <(...), bash -c, eval, < , cd)', () => {
  const bloqueados = [
    'cat modules/core/a.ts',
    'sed -n 1,40p apps/api/src/app.ts',
    'head -20 packages/platform-sdk/src/index.ts',
    'tail -5 db/migracoes/001.sql',
    'grep -n foo scripts/coord.mjs',
    'rg defineModule packages',
    "awk 'NR<10' tests/a.test.ts",
    'cat .github/workflows/ci.yml',
    'git status && cat modules/core/a.ts | wc -l',
    'ls; grep -rn foo modules/ | head',
    'echo $(head -3 db/x.sql)',
    'bash -c "cat apps/x.ts"',
    'wc -l < modules/a.ts; head < modules/a.ts',
    'cd modules && cat core/a.ts',
    'grep -rn defineModule',
    'rg foo',
    `cat ${ERP}/modules/a.ts`,
    `cat ${WT}/modules/a.ts`,
    'sudo cat apps/a.ts',
    'FOO=1 cat apps/a.ts',
    'diff <(cat modules/a.ts) x',
    'cat < <(cat modules/a.ts)',
    'tee >(cat modules/a.ts)',
    'eval "cat apps/x.ts"',
    'eval cat apps/x.ts',
    'eval "cat modules/$F"',
    'bash -c "cat modules/$F"',
    'nice -n 10 cat modules/a.ts',
    'timeout 5 cat modules/a.ts',
    'echo x | xargs -n1 cat modules/a.ts',
    'if true; then cat modules/a.ts; fi',
    '/usr/bin/CAT modules/a.ts',
  ];
  for (const c of bloqueados) assert.equal(bash(c).mensagem, MENSAGEM_ERP, c);
  for (const c of ['diff <(cat modules/a.ts) x', 'eval "cat apps/x.ts"']) assert.equal(bash(c, SO_ERP).mensagem, null, `${c} com a marca`);
});

test('Bash sem marca: docs, .md, .coord, recados e comandos que não leem passam', () => {
  const livres = [
    'cat docs/produto/02-modulos.md',
    'grep -rn "modules/core" docs',
    'head -40 modules/core/LEIA.md',
    'cat .coord/tarefas/T-0064.md .coord/donos.json',
    `cat ${REC}/recados/gerente/R-1.txt`,
    'node scripts/coord.mjs caixa engenheiro-software',
    'ls modules apps',
    'git diff -- modules',
    'pnpm --filter @macuxi/api test',
    'cat /etc/hosts',
    'wc -l modules/a.ts',
    'eval "cat docs/a.txt"',
    'diff <(cat docs/a.txt) docs/b.txt',
  ];
  for (const c of livres) assert.equal(bash(c).mensagem, null, c);
});

test('Bash: graphify explain/query/path/section/update marcam o ERP e liberam a leitura no mesmo comando', () => {
  for (const g of ['graphify explain "RAIZ"', 'graphify query "como roda o worker" --budget 1500', 'graphify path "A" "B"', 'graphify section "docs/x.md#Seção"', 'graphify update .', 'python3 -m graphify explain x']) {
    const r = bash(g);
    assert.deepEqual(r.marcar, ['erp'], g);
    assert.equal(r.mensagem, null, g);
    assert.equal(bash(`${g} && sed -n 1,20p modules/a.ts`).mensagem, null, `${g} && leitura`);
  }
  assert.equal(bash('graphify --help').marcar.length, 0, 'graphify sem subcomando de consulta não marca');
  assert.equal(bash('cat modules/a.ts; graphify explain x').mensagem, MENSAGEM_ERP, 'leitura antes do graphify continua bloqueada');
  assert.deepEqual(bash('cat graphify-out/GRAPH_REPORT.md | head -60').marcar, ['erp'], 'ler o relatório pelo Bash marca');
  assert.deepEqual(bash(`head -60 ${ERP}/graphify-out/GRAPH_REPORT.md`, SEM, WT).marcar, ['erp'], 'o relatório do principal vale no worktree');
  assert.equal(bash('cat modules/a.ts', SO_ERP).mensagem, null, 'com a marca passa');
});

test('Bash FDV: marca do ERP não libera; só update no clone ou query --graph do clone marcam o FDV', () => {
  assert.equal(bash(`cat ${FDV}/app/Main.kt`, SO_ERP).mensagem, mensagemFdv(FDV));
  assert.equal(bash('grep -rn Pedido .', SO_ERP, FDV).mensagem, mensagemFdv(FDV));
  assert.equal(bash(`cat ${FDV}/README.md`).mensagem, null, '.md do FDV é livre');
  assert.deepEqual(bash(`cd ${FDV} && graphify update .`).marcar, ['fdv']);
  assert.deepEqual(bash('graphify update .', SEM, FDV).marcar, ['fdv']);
  assert.deepEqual(bash(`graphify update ${FDV}`).marcar, ['fdv']);
  assert.deepEqual(bash(`graphify query "rota de pedidos" --graph ${FDV}/graphify-out/graph.json --budget 1500`).marcar, ['fdv']);
  assert.deepEqual(bash('graphify explain Pedido', SEM, FDV).marcar, [], 'explain no FDV não dá a marca do FDV');
  assert.deepEqual(bash('graphify query "x"', SEM, FDV).marcar, [], 'query sem --graph no FDV não dá a marca');
  assert.equal(bash(`cd ${FDV} && graphify update . && cat app/Main.kt`).mensagem, null);
  assert.equal(bash(`cat ${FDV}/app/Main.kt`, SO_FDV).mensagem, null);
  assert.equal(bash('cat modules/a.ts', SO_FDV).mensagem, MENSAGEM_ERP, 'marca do FDV não libera o ERP');
  assert.deepEqual(bash(`cd ${FDV} && graphify update .`).marcar.includes('erp'), false);
});

test('Read/Grep puros: marca, relatório, trecho acima de 300 linhas e glob de markdown', () => {
  const linhas = (n) => () => n;
  const read = (arquivo, marcas, extra = {}) => decidirRead({ arquivo, cwd: ERP, marcas, repoDe, contarLinhas: linhas(500), ...extra });
  assert.equal(read('modules/a.ts', SEM).mensagem, MENSAGEM_ERP);
  assert.equal(read(`${ERP}/graphify-out/GRAPH_REPORT.md`, SEM).marcar, 'erp');
  assert.equal(read(`${FDV}/graphify-out/GRAPH_REPORT.md`, SEM).marcar, null, 'relatório do FDV não marca o ERP');
  assert.ok(read('modules/a.ts', SO_ERP).mensagem.startsWith(MENSAGEM_TRECHO));
  assert.equal(read('modules/a.ts', SO_ERP, { offset: 10 }).mensagem, null);
  assert.equal(read('modules/a.ts', SO_ERP, { limit: 50 }).mensagem, null);
  assert.equal(read('modules/a.ts', SO_ERP, { contarLinhas: linhas(300) }).mensagem, null, '300 linhas cabem');
  assert.equal(read('docs/grande.txt', SEM).mensagem, null);
  assert.ok(globSoMarkdown('**/*.md') && globSoMarkdown('*.{md,markdown}') && !globSoMarkdown('*.{md,ts}') && !globSoMarkdown('*.ts'));
  const grep = (x) => decidirGrep({ cwd: ERP, repoDe, marcas: SEM, ...x }).mensagem;
  assert.equal(grep({}), MENSAGEM_ERP, 'Grep sem path na raiz do ERP');
  assert.equal(grep({ path: 'modules' }), MENSAGEM_ERP);
  assert.equal(grep({ glob: '**/*.md' }), null);
  assert.equal(grep({ type: 'md' }), null);
  assert.equal(grep({ path: 'docs' }), null);
  assert.equal(grep({ path: '.coord' }), null);
});

// ───────────────────────────── Parte 2: hooks de verdade ─────────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const escrever = (dir, rel, txt = 'x\n') => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), txt); };
const novoRepo = (base, nome, remote) => {
  const dir = join(base, nome);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
};
const commitar = (dir) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: engenheiro-software'); };

function criarAmbiente() {
  const base = mkdtempSync(join(tmpdir(), 'guarda-graphify-'));
  temporarios.push(base);
  const erp = novoRepo(base, 'macuxierp', 'https://github.com/aloirr/macuxierp.git');
  escrever(erp, '.coord/donos.json', JSON.stringify({ agentes: {}, somente_leitura: [] }, null, 2));
  escrever(erp, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }, null, 2));
  escrever(erp, 'modules/core/a.ts', 'export const a = 1;\n');
  escrever(erp, 'apps/api/grande.ts', Array.from({ length: 400 }, (_, i) => `// linha ${i + 1}`).join('\n') + '\n');
  escrever(erp, '.gitignore', 'graphify-out/\n');
  mkdirSync(join(erp, 'scripts'), { recursive: true });
  for (const f of ['coord-lib.mjs', 'coord.mjs']) copyFileSync(join(RAIZ_REAL, 'scripts', f), join(erp, 'scripts', f));
  mkdirSync(join(erp, '.claude', 'hooks'), { recursive: true });
  for (const f of ['guarda-graphify.mjs', 'guarda-graphify-lib.mjs', 'guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-interpretador-lib.mjs', 'guarda-merge-lib.mjs']) {
    copyFileSync(join(AQUI, f), join(erp, '.claude', 'hooks', f));
  }
  commitar(erp);
  escrever(erp, 'graphify-out/GRAPH_REPORT.md', '# Graph Report\n'); // fora do versionamento, só no principal
  const wt = join(base, 'erp-wt');
  git(erp, 'worktree', 'add', '-q', '-b', 'agente/T-0064-wt', wt);

  const fdv = novoRepo(base, 'macuxifdv', 'git@github.com:aloirr/macuxifdv.git');
  escrever(fdv, 'app/src/Main.kt', 'fun main() {}\n');
  commitar(fdv);

  return { base, erp, wt, fdv };
}

const ENV_LIMPO = (() => {
  const e = { ...process.env };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GUARDA', 'MACUXI_GH_SIMULADO']) delete e[k];
  return e;
})();

function rodar(raizHook, hook, json, env = {}) {
  const r = spawnSync(process.execPath, [join(raizHook, '.claude', 'hooks', hook)], {
    cwd: raizHook, input: typeof json === 'string' ? json : JSON.stringify(json), encoding: 'utf8', env: { ...ENV_LIMPO, ...env },
  });
  return { codigo: r.status, erro: r.stderr };
}
const ler = (amb, sessao, file_path, extra = {}, raiz = amb.erp, env) =>
  rodar(raiz, 'guarda-graphify.mjs', { session_id: sessao, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path, ...extra }, cwd: raiz }, env);
const procurar = (amb, sessao, tool_input, raiz = amb.erp, env) =>
  rodar(raiz, 'guarda-graphify.mjs', { session_id: sessao, hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input, cwd: raiz }, env);
const sh = (amb, sessao, command, cwd = amb.erp, raiz = amb.erp, env) =>
  rodar(raiz, 'guarda-bash.mjs', { session_id: sessao, tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }, env);

const AMB = criarAmbiente();

// Um caso por caminho do hook; as variações (comandos, livres, FDV) ficam nas puras acima.

test('hook: sem marca bloqueia com a mensagem exata; graphify explain (Bash) e Read do relatório marcam', () => {
  const a = join(AMB.erp, 'modules/core/a.ts');
  for (const r of [ler(AMB, 's-explain', a), procurar(AMB, 's-explain', { pattern: 'x' }), sh(AMB, 's-explain', 'cat modules/core/a.ts')]) {
    assert.equal(r.codigo, 2, r.erro);
    assert.equal(r.erro.trim(), MENSAGEM_ERP);
  }
  assert.equal(sh(AMB, 's-explain', 'graphify explain "RAIZ"').codigo, 0);
  assert.equal(ler(AMB, 's-explain', a).codigo, 0, 'Read liberado');
  assert.equal(procurar(AMB, 's-explain', { pattern: 'x', path: join(AMB.erp, 'apps') }).codigo, 0, 'Grep liberado');
  assert.equal(sh(AMB, 's-explain', 'cat modules/core/a.ts').codigo, 0, 'Bash liberado');
  assert.equal(ler(AMB, 's-relatorio', join(AMB.erp, 'graphify-out/GRAPH_REPORT.md'), { limit: 60 }).codigo, 0);
  assert.equal(ler(AMB, 's-relatorio', a).codigo, 0, 'Read do relatório marca');
  assert.ok(existsSync(join(AMB.erp, '.git', 'macuxi-graphify')), 'marca no git common dir');
  assert.equal(git(AMB.erp, 'status', '--porcelain'), '', 'a marca fica fora do versionamento');
});

test('hook: worktree usa a marca do principal', () => {
  const wtA = join(AMB.wt, 'modules/core/a.ts');
  assert.equal(ler(AMB, 's-wt', wtA, {}, AMB.wt).codigo, 2, 'worktree sem marca bloqueia');
  assert.equal(sh(AMB, 's-wt', 'graphify explain x').codigo, 0, 'marca gravada pelo principal');
  assert.equal(ler(AMB, 's-wt', wtA, {}, AMB.wt).codigo, 0, 'vale no hook do worktree');
});

test('hook: marca de outra session_id não libera', () => {
  assert.equal(sh(AMB, 's-dona', 'graphify explain x').codigo, 0);
  assert.equal(ler(AMB, 's-outra', join(AMB.erp, 'modules/core/a.ts')).codigo, 2);
});

test('hook: MACUXI_GUARDA=off não desliga', () => {
  const env = { MACUXI_GUARDA: 'off' };
  assert.equal(ler(AMB, 's-off', join(AMB.erp, 'modules/core/a.ts'), {}, AMB.erp, env).codigo, 2);
  assert.equal(sh(AMB, 's-off', 'cat modules/core/a.ts', AMB.erp, AMB.erp, env).codigo, 2);
  for (const f of ['guarda-graphify.mjs', 'guarda-graphify-lib.mjs']) {
    assert.ok(!/process\.env/.test(readFileSync(join(AQUI, f), 'utf8')), `${f} não lê variável de ambiente`);
  }
});

test('hook: entrada ilegível passa (padrão dos guardas)', () => {
  assert.equal(rodar(AMB.erp, 'guarda-graphify.mjs', '{isto não é json', {}).codigo, 0);
});

test('hook FDV: update no clone libera; marca do ERP não libera', () => {
  const kt = join(AMB.fdv, 'app/src/Main.kt');
  assert.equal(sh(AMB, 's-fdv', 'graphify explain x').codigo, 0, 'marca do ERP');
  const r = ler(AMB, 's-fdv', kt);
  assert.equal(r.codigo, 2, 'marca do ERP não libera o FDV');
  assert.equal(r.erro.trim(), mensagemFdv(AMB.fdv));
  assert.equal(sh(AMB, 's-fdv', `cd ${AMB.fdv} && graphify update .`).codigo, 0);
  assert.equal(ler(AMB, 's-fdv', kt).codigo, 0, 'update no clone libera');
});

test('hook: Read acima de 300 linhas bloqueia sem offset/limit e passa com limit', () => {
  const grande = join(AMB.erp, 'apps/api/grande.ts');
  assert.equal(sh(AMB, 's-trecho', 'graphify explain grande').codigo, 0);
  const r = ler(AMB, 's-trecho', grande);
  assert.equal(r.codigo, 2);
  assert.ok(r.erro.startsWith(MENSAGEM_TRECHO), r.erro);
  assert.equal(ler(AMB, 's-trecho', grande, { limit: 50 }).codigo, 0);
});
