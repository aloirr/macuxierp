// Trava do graphify (T-0064, pedido do Alexandre R-20261123-164322: "leitura de código só depois de consultar o
// graphify"; regra R-20261122-035710 do CLAUDE.md). Lógica pura + E/S mínima (git, marca da sessão).
// Usado por .claude/hooks/guarda-graphify.mjs (Read|Grep) e .claude/hooks/guarda-bash.mjs (Bash).
//  - Código do ERP: modules/ apps/ packages/ db/ scripts/ tests/ .github/ (e a raiz do repositório, que os contém),
//    no repositório principal, em qualquer worktree dele (mesmo git common dir) ou noutro clone do aloirr/macuxierp.
//  - Código do FDV: qualquer arquivo de um clone cujo remote aponte para macuxifdv (exceto os livres abaixo).
//  - Livres: *.md, docs/**, .coord/**, graphify-out/**, o clone de recados (remote macuxierp-recados) e o resto.
//  - Marca por session_id em <git common dir do ERP>/macuxi-graphify/<sessao>.json (fora do versionamento e
//    compartilhada pelos worktrees). Duas marcas separadas:
//      · erp: graphify query|explain|path|section|update com alvo fora de clone do FDV, ou leitura do
//        graphify-out/GRAPH_REPORT.md do ERP (principal ou worktree; Read ou cat/head/sed/... no Bash);
//      · fdv: `graphify update` com alvo no clone do FDV (cwd, `cd <clone> && graphify update .` ou
//        `graphify update <clone>`) ou `graphify query ... --graph <clone-fdv>/graphify-out/graph.json`.
//    A marca do ERP não libera o FDV e vice-versa.
//  - Read de arquivo de código com mais de 300 linhas sem offset/limit: bloqueado mesmo com a marca.
//  - Sem desligamento por variável de ambiente (nem MACUXI_GUARDA=off).
// Casos: .claude/hooks/guarda-graphify.test.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tokenizar, comandosSimples, absoluto } from './guarda-bash-lib.mjs';
import { substituicoes, semAtribuicoes, nomeBase, classificarComando } from './guarda-merge-lib.mjs';

const REGRA = 'R-20261122-035710';
export const MENSAGEM_ERP = `Consulte o graphify antes: graphify explain "<símbolo>" ou leia graphify-out/GRAPH_REPORT.md (${REGRA})`;
export const mensagemFdv = (clone) => {
  const c = clone || '<clone-fdv>';
  return `Consulte o graphify do FDV antes (a marca do ERP não vale para o FDV): cd ${c} && graphify update . `
    + `ou graphify query "<pergunta>" --graph ${c}/graphify-out/graph.json --budget 1500 (${REGRA})`;
};
export const MENSAGEM_TRECHO = 'leia só o trecho: use offset e limit';
const LIMITE_LINHAS = 300;

const PASTAS_DE_CODIGO = ['modules', 'apps', 'packages', 'db', 'scripts', 'tests', '.github'];
const PASTAS_LIVRES = ['docs', '.coord', 'graphify-out'];
const SUBCOMANDOS = new Set(['query', 'explain', 'path', 'section', 'update']);

const barras = (p) => String(p).replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const minusculo = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
const sob = (abs, base) => {
  const a = minusculo(barras(abs));
  const b = minusculo(barras(base));
  return a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`);
};

// ───────────────────────────── classificação de caminhos (pura) ─────────────────────────────

/** Tipo pelo(s) remote(s): 'fdv' (macuxifdv), 'recados' (macuxierp-recados), 'erp' (macuxierp) ou null. */
export function tipoPorRemotes(urls = []) {
  const lista = urls.map((u) => String(u).trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase());
  if (lista.some((u) => /(^|[/:])macuxifdv$/.test(u))) return 'fdv';
  if (lista.some((u) => /(^|[/:])macuxierp-recados$/.test(u))) return 'recados';
  if (lista.some((u) => /(^|[/:])macuxierp$/.test(u))) return 'erp';
  return null;
}

/**
 * Classifica um caminho absoluto. `repoDe(abs)` → {top, tipo:'erp'|'fdv'|'recados'|null} ou null (fora de repo).
 * Retorna {tipo:'livre'} | {tipo:'erp', rel, top} | {tipo:'fdv', rel, top}.
 */
export function classificar(abs, repoDe) {
  if (!abs) return { tipo: 'livre' };
  const a = barras(abs);
  if (/\.md$/i.test(a)) return { tipo: 'livre' };
  const repo = repoDe(a);
  if (!repo || !repo.top || (repo.tipo !== 'erp' && repo.tipo !== 'fdv')) return { tipo: 'livre' };
  if (!sob(a, repo.top)) return { tipo: 'livre' };
  const rel = a.slice(barras(repo.top).length).replace(/^\/+/, '');
  const primeiro = rel.split('/')[0];
  if (PASTAS_LIVRES.includes(primeiro)) return { tipo: 'livre' };
  if (repo.tipo === 'fdv') return { tipo: 'fdv', rel, top: barras(repo.top) };
  // ERP: a raiz (rel '') contém as pastas de código, então conta como código (grep -r na raiz, Grep sem path).
  if (rel === '' || PASTAS_DE_CODIGO.includes(primeiro)) return { tipo: 'erp', rel, top: barras(repo.top) };
  return { tipo: 'livre' };
}

/** O caminho é o graphify-out/GRAPH_REPORT.md do ERP (principal ou worktree)? */
function ehRelatorioDoErp(abs, repoDe) {
  if (!abs) return false;
  const a = barras(abs);
  if (!/(^|\/)graphify-out\/GRAPH_REPORT\.md$/.test(a)) return false;
  const repo = repoDe(dirname(dirname(a)));
  return Boolean(repo && repo.tipo === 'erp');
}

/** Mensagem de bloqueio para um alvo classificado sem a marca correspondente, ou null. */
function bloqueioPorMarca(cls, marcas) {
  if (cls.tipo === 'erp' && !marcas.erp) return MENSAGEM_ERP;
  if (cls.tipo === 'fdv' && !marcas.fdv) return mensagemFdv(cls.top);
  return null;
}

// ───────────────────────────── Read e Grep (puras) ─────────────────────────────

const vazio = (v) => v === undefined || v === null || v === '';

/** Read: {marcar: 'erp'|null, mensagem: string|null}. `contarLinhas(abs)` → número ou null. */
export function decidirRead({ arquivo, offset, limit, cwd, marcas, repoDe, contarLinhas }) {
  const abs = arquivo ? absoluto(arquivo, cwd, cwd || '/') : null;
  if (!abs) return { marcar: null, mensagem: null };
  if (ehRelatorioDoErp(abs, repoDe)) return { marcar: 'erp', mensagem: null };
  const cls = classificar(abs, repoDe);
  if (cls.tipo === 'livre') return { marcar: null, mensagem: null };
  const m = bloqueioPorMarca(cls, marcas);
  if (m) return { marcar: null, mensagem: m };
  if (vazio(offset) && vazio(limit)) {
    const n = contarLinhas(abs);
    if (typeof n === 'number' && n > LIMITE_LINHAS) {
      return { marcar: null, mensagem: `${MENSAGEM_TRECHO} (${cls.rel || abs} tem ${n} linhas; acima de ${LIMITE_LINHAS}, só com offset/limit)` };
    }
  }
  return { marcar: null, mensagem: null };
}

/** O glob do Grep só pega markdown (*.md, **\/*.md, *.{md,markdown})? */
export function globSoMarkdown(glob) {
  const g = String(glob || '').trim();
  if (!g) return false;
  const m = g.match(/\.(\{[^}]*\}|[A-Za-z0-9]+)$/);
  if (!m) return false;
  const exts = m[1].replace(/[{}]/g, '').split(',').map((e) => e.trim().toLowerCase());
  return exts.length > 0 && exts.every((e) => e === 'md' || e === 'markdown');
}

/** Grep: {mensagem}. Sem path = cwd. Busca restrita a markdown (glob *.md, type md/markdown) é livre. */
export function decidirGrep({ path, glob, type, cwd, marcas, repoDe }) {
  if (globSoMarkdown(glob) || /^(md|markdown)$/i.test(String(type || ''))) return { mensagem: null };
  const abs = absoluto(path || cwd || '', cwd, cwd || '/');
  if (!abs) return { mensagem: null };
  return { mensagem: bloqueioPorMarca(classificar(abs, repoDe), marcas) };
}

// ───────────────────────────── Bash (pura) ─────────────────────────────

const LEITORES = new Set(['cat', 'sed', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'awk', 'gawk', 'mawk', 'less', 'more', 'bat', 'nl', 'tac']);

/** Opções que consomem o próximo token, por família de leitor. */
const OPCOES_COM_VALOR = {
  grep: ['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context', '--include', '--exclude', '--exclude-dir', '--label', '--devices', '--directories', '--binary-files'],
  rg: ['-e', '-f', '-g', '-t', '-T', '-m', '-A', '-B', '-C', '-j', '-M', '-r', '-E', '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--max-count', '--after-context', '--before-context', '--context', '--threads', '--max-columns', '--replace', '--max-depth', '--encoding', '--type-add', '--sort', '--sortr', '--max-filesize', '--pre', '--pre-glob', '--colors', '--path-separator', '--engine'],
  sed: ['-e', '-f', '-l', '--expression', '--file', '--line-length'],
  awk: ['-f', '-v', '-F', '--file', '--assign', '--field-separator'],
  head: ['-n', '-c', '--lines', '--bytes'],
  tail: ['-n', '-c', '--lines', '--bytes', '-s', '--sleep-interval', '--pid'],
  bat: ['-l', '-r', '-H', '-m', '--language', '--line-range', '--highlight-line', '--style', '--theme', '--map-syntax'],
  tac: ['-s', '--separator'],
};
const familia = (cmd) => {
  if (cmd === 'egrep' || cmd === 'fgrep') return 'grep';
  if (cmd === 'gawk' || cmd === 'mawk') return 'awk';
  return cmd;
};

/**
 * Caminhos lidos por um leitor (args = palavras depois do nome). grep/rg/sed/awk: o 1º posicional é o
 * padrão/script, salvo se veio por -e/-f. `recursivo`: busca sem caminho (rg; grep -r) = o cwd.
 */
export function caminhosDoLeitor(cmd, args) {
  const fam = familia(cmd);
  const comValor = new Set(OPCOES_COM_VALOR[fam] || []);
  const posicionais = [];
  let scriptPorOpcao = false;
  let recursivo = fam === 'rg';
  let fimDeOpcoes = false;
  for (let i = 0; i < args.length; i++) {
    const v = args[i].valor;
    if (!fimDeOpcoes && v === '--') { fimDeOpcoes = true; continue; }
    if (!fimDeOpcoes && v.startsWith('-') && v !== '-') {
      const nome = v.includes('=') ? v.slice(0, v.indexOf('=')) : v;
      if (['-e', '-f', '--regexp', '--file', '--expression'].includes(nome) && fam !== 'head' && fam !== 'tail') scriptPorOpcao = true;
      if (fam === 'grep' && /^-[A-Za-z]*[rR]/.test(v) && !v.startsWith('--')) recursivo = true;
      if (fam === 'grep' && (nome === '--recursive' || nome === '--dereference-recursive')) recursivo = true;
      if (comValor.has(v)) i++;
      continue;
    }
    posicionais.push(args[i]);
  }
  const temScript = ['grep', 'rg', 'sed', 'awk'].includes(fam);
  const arquivos = temScript && !scriptPorOpcao ? posicionais.slice(1) : posicionais;
  return { arquivos, recursivo: recursivo && arquivos.length === 0 };
}

/**
 * Nome e argumentos de um comando simples, sem VAR=..., prefixos (sudo, env, timeout...) e palavras-chave
 * (semAtribuicoes da guarda-merge-lib), e também sem o número do `nice -n 10` e as opções do `xargs`.
 */
function comandoReal(palavras) {
  let r = semAtribuicoes(palavras);
  for (let i = 0; i < 8 && r.nome && !r.nome.incerto; i++) {
    const n = nomeBase(r.nome.valor);
    let resto;
    if (/^\d+(\.\d+)?[smhd]?$/.test(r.nome.valor)) resto = r.args;
    else if (n === 'xargs' || n === 'parallel') {
      let k = 0;
      while (k < r.args.length && r.args[k].valor.startsWith('-')) k += /^-[IinPLdEsa]$|^--(replace|max-args|max-procs|delimiter|eof|arg-file)$/.test(r.args[k].valor) ? 2 : 1;
      resto = r.args.slice(k);
    } else break;
    r = semAtribuicoes(resto);
  }
  return r;
}

/**
 * Bash: percorre os comandos simples em ordem (cd muda o cwd; graphify antes da leitura libera a leitura no
 * mesmo comando composto; $(...), `...`, <(...), >(...), bash -c "..." e eval "..." são analisados por dentro).
 * Retorna {marcar: ['erp'|'fdv'...], mensagem: string|null}.
 */
export function analisarBash({ comando, cwd, marcas, repoDe }) {
  const estado = { erp: Boolean(marcas.erp), fdv: Boolean(marcas.fdv) };
  const marcar = new Set();
  let mensagem = null;
  const marca = (m) => { estado[m] = true; marcar.add(m); };

  const percorrer = (texto, cwdInicial, profundidade) => {
    if (profundidade > 4 || mensagem) return;
    let dir = cwdInicial;
    let lista;
    try { lista = comandosSimples(tokenizar(texto)); } catch { return; }
    for (const c of lista) {
      if (mensagem) return;
      if (c.grupo) continue;
      for (const p of c.palavras) if (p.incerto) for (const inner of substituicoes(p.valor)) percorrer(inner, dir, profundidade + 1);
      for (const r of c.redirs) if (r.alvo?.incerto) for (const inner of substituicoes(r.alvo.valor)) percorrer(inner, dir, profundidade + 1);
      if (mensagem) return;
      const { nome: primeira, args } = comandoReal(c.palavras);
      if (!primeira || primeira.incerto) continue;
      const nome = nomeBase(primeira.valor);

      if (nome === 'cd' || nome === 'pushd') {
        const alvo = args.find((a) => !a.valor.startsWith('-'));
        if (alvo) dir = alvo.incerto ? null : absoluto(alvo.valor, dir, dir || '/');
        continue;
      }
      // bash -c "..." e eval "...": o texto interno é analisado como comando, também com $VAR dentro
      // (incerto: false só para obter o texto; o $VAR volta a ser incerto ao tokenizar o interno).
      const { interno } = classificarComando(c.palavras.map((p) => ({ ...p, incerto: false })));
      if (interno) { percorrer(interno, dir, profundidade + 1); continue; }
      const ehGraphify = nome === 'graphify'
        || ((nome === 'python' || nome === 'python3') && args[0]?.valor === '-m' && args[1]?.valor === 'graphify');
      if (ehGraphify) {
        const resto = nome === 'graphify' ? args : args.slice(2);
        const iSub = resto.findIndex((a) => !a.valor.startsWith('-'));
        const sub = iSub >= 0 ? resto[iSub].valor : null;
        if (!SUBCOMANDOS.has(sub)) continue;
        let alvoRepo = dir;
        if (sub === 'update') {
          const p = resto.slice(iSub + 1).find((a) => !a.valor.startsWith('-'));
          if (p) alvoRepo = p.incerto ? null : absoluto(p.valor, dir, dir || '/');
        }
        const iGraph = resto.findIndex((a) => a.valor === '--graph' || a.valor.startsWith('--graph='));
        if (iGraph >= 0) {
          const g = resto[iGraph].valor.startsWith('--graph=') ? resto[iGraph].valor.slice('--graph='.length) : resto[iGraph + 1]?.valor;
          alvoRepo = g ? absoluto(g, dir, dir || '/') : null;
        }
        const repo = alvoRepo ? repoDe(alvoRepo) : null;
        if (repo?.tipo === 'fdv') {
          // FDV: só `graphify update` no clone ou `graphify query --graph <clone>/...`.
          if (sub === 'update' || (sub === 'query' && iGraph >= 0)) marca('fdv');
        } else marca('erp');
        continue;
      }
      if (!LEITORES.has(nome)) continue;
      const { arquivos, recursivo } = caminhosDoLeitor(nome, args);
      const alvos = arquivos.filter((a) => a.valor !== '-').map((a) => a.valor);
      for (const r of c.redirs) if (r.op === '<' && r.alvo && !r.alvo.incerto) alvos.push(r.alvo.valor);
      if (recursivo && dir) alvos.push(dir);
      for (const alvo of alvos) {
        const abs = absoluto(alvo, dir, dir || '/');
        if (!abs) continue;
        if (ehRelatorioDoErp(abs, repoDe)) { marca('erp'); continue; }
        const m = bloqueioPorMarca(classificar(abs, repoDe), estado);
        if (m) { mensagem = m; return; }
      }
    }
  };

  percorrer(comando, cwd, 0);
  return { marcar: [...marcar], mensagem };
}

// ───────────────────────────── E/S: repositórios e marca ─────────────────────────────

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();

/** Pasta existente mais próxima (o arquivo pode não existir ainda). */
function pastaExistente(abs) {
  let d = abs;
  for (let i = 0; i < 128; i++) {
    try { if (statSync(d).isDirectory()) return d; } catch { /* sobe */ }
    const pai = dirname(d);
    if (pai === d) return null;
    d = pai;
  }
  return null;
}

/** git common dir absoluto do repositório que contém `dir` (ou null). Num worktree, é o .git do principal. */
export function commonDirDe(dir) {
  try {
    const d = pastaExistente(barras(dir));
    return d ? barras(git(d, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) : null;
  } catch { return null; }
}

/**
 * repoDe(abs) com cache por pasta: {top, tipo}. tipo 'erp' quando o common dir é o do ERP (principal e
 * worktrees) ou o remote é o aloirr/macuxierp; 'fdv' e 'recados' pelo remote (qualquer remote).
 */
export function criarRepoDe(comumErp) {
  const cache = new Map();
  return (abs) => {
    const dir = pastaExistente(barras(abs));
    if (!dir) return null;
    if (cache.has(dir)) return cache.get(dir);
    let info = null;
    try {
      const [top, comum] = git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']).split('\n').map(barras);
      let urls = [];
      try { urls = git(dir, ['config', '--get-regexp', '^remote\\..*\\.url$']).split('\n').map((l) => l.split(/\s+/).slice(1).join(' ')); } catch { /* sem remote */ }
      let tipo = tipoPorRemotes(urls);
      if (comumErp && minusculo(comum) === minusculo(barras(comumErp))) tipo = 'erp';
      info = { top, tipo };
    } catch { info = null; }
    cache.set(dir, info);
    return info;
  };
}

const PASTA_MARCAS = 'macuxi-graphify';
const idSessao = (sid) => (String(sid || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'sem-sessao');

/** Arquivo da marca da sessão (no git common dir do ERP: fora do versionamento, igual para todos os worktrees). */
const arquivoMarca = (comum, sessao) => join(comum, PASTA_MARCAS, `${idSessao(sessao)}.json`);

export function lerMarcas(comum, sessao) {
  if (!comum) return { erp: false, fdv: false };
  try {
    const j = JSON.parse(readFileSync(arquivoMarca(comum, sessao), 'utf8'));
    return { erp: Boolean(j.erp), fdv: Boolean(j.fdv) };
  } catch { return { erp: false, fdv: false }; }
}

export function gravarMarcas(comum, sessao, novas) {
  if (!comum || !novas?.length) return;
  try {
    let j = {};
    try { j = JSON.parse(readFileSync(arquivoMarca(comum, sessao), 'utf8')) || {}; } catch { /* primeira marca */ }
    const agora = new Date().toISOString();
    for (const n of novas) j[n] = j[n] || agora;
    mkdirSync(join(comum, PASTA_MARCAS), { recursive: true });
    writeFileSync(arquivoMarca(comum, sessao), JSON.stringify(j));
    limparMarcasAntigas(comum);
  } catch { /* sem gravar: a próxima leitura de código bloqueia de novo */ }
}

/** Apaga marcas com mais de 7 dias. */
function limparMarcasAntigas(comum, dias = 7) {
  try {
    const pasta = join(comum, PASTA_MARCAS);
    const limite = Date.now() - dias * 86400000;
    for (const f of readdirSync(pasta)) {
      const p = join(pasta, f);
      try { if (statSync(p).mtimeMs < limite) unlinkSync(p); } catch { /* concorrência */ }
    }
  } catch { /* nada */ }
}

/** Número de linhas de um arquivo (null se não for arquivo legível). */
export function contarLinhas(abs) {
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;
    const txt = readFileSync(abs, 'utf8');
    if (!txt) return 0;
    const n = txt.split('\n').length;
    return txt.endsWith('\n') ? n - 1 : n;
  } catch { return null; }
}
