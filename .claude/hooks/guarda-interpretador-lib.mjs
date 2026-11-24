// Guardião de donos para o Bash — escrita por INTERPRETADOR (R-20261124-181828; decisão do Alexandre
// R-20261124-182330, opção A). Funções puras, sem dependências; usadas por alvosDoComando (guarda-bash-lib.mjs).
//
// O furo: subagentes editavam arquivo com `python3 - <<EOF ... open(p,'w') ... EOF`, `node -e "writeFileSync(...)"`
// e afins, e o guardião não via o alvo. Agora, para CÓDIGO INLINE de python/node/deno/bun/perl/ruby/php/lua
// (-c/-e/--eval/-p, eval, here-doc, here-string ou código vindo pela entrada padrão), o guardião procura as
// chamadas que gravam (open(...,'w'/'a'), write_text, writeFileSync, appendFile, createWriteStream, rename,
// unlink, rm, mkdir, shutil.*, os.remove, Path(...).write_*, File.write, FileUtils.*, file_put_contents...) e
// resolve o caminho de cada uma: literal, variável com literal, join de literais, lista literal no for.
//  - caminho resolvido → vira alvo evidente, com as MESMAS regras de donos do > / tee / cp (passa se for do agente);
//  - caminho que não dá para determinar (variável de fora, argv, env, f-string, glob, concatenação dinâmica,
//    chdir no código) ou código que executa outro processo (subprocess, child_process, os.system, exec, eval,
//    crase) → bloqueado: "use Edit/Write".
// Rodar ARQUIVO de script (node scripts/x.mjs, python3 tools/y.py, python3 -m mod, pnpm ...) continua permitido:
// o alvo é o código inline. Leitura (open(p) sem modo de escrita, readFileSync, cat...) passa.
import { posix } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const barras = (p) => String(p).replace(/\\/g, '/');
const nomeBase = (p) => barras(p).replace(/\/+$/, '').split('/').pop();

/** Linguagem do interpretador pelo nome do comando (python3.12, /usr/bin/node, tsx...) ou null. */
export function linguagemDe(nome) {
  const n = nomeBase(nome).replace(/\.exe$/i, '').toLowerCase();
  if (/^(python[\d.]*|py|pypy[\d.]*)$/.test(n)) return 'python';
  if (['node', 'nodejs', 'tsx', 'ts-node'].includes(n)) return 'node';
  if (/^lua[\d.]*$/.test(n)) return 'lua';
  if (['deno', 'bun', 'perl', 'ruby', 'php'].includes(n)) return n;
  return null;
}

// ───────────────────────────── onde está o código ─────────────────────────────

/** Opções curtas por linguagem: código, script/módulo, opção com argumento, opção que come o resto do grupo. */
const CURTAS = {
  python: { codigo: 'c', script: 'm', comArg: 'WXQ', colado: '', digitos: '', info: 'Vh?', para: true },
  perl: { codigo: 'eE', script: '', comArg: '', colado: 'iIMmxCdD', digitos: 'l0', info: 'vVh', para: false },
  ruby: { codigo: 'e', script: '', comArg: 'IrCE', colado: 'ixK', digitos: '0TW', info: 'vh', para: false },
  php: { codigo: 'r', script: 'f', comArg: 'cdz', colado: '', digitos: '', info: 'vhim', para: true },
  lua: { codigo: 'e', script: '', comArg: 'l', colado: '', digitos: '', info: 'v', para: false },
};
const NODE_CODIGO = new Set(['-e', '--eval', '-p', '--print', '-pe', '-ep']);
const NODE_COM_ARG = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type', '--env-file', '--title', '--inspect-port', '--run', '--watch-path', '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--stack-size']);
const INFO_LONGA = /^--(version|help)$/;

/**
 * Código inline do comando de interpretador (função pura).
 * @param {string} linguagem  de linguagemDe
 * @param {{valor: string, incerto: boolean}[]} args  argumentos (sem o nome do comando)
 * @param {{heredocs?: {corpo: string, incerto: boolean}[], herestrings?: {valor: string, incerto: boolean}[], entradaArquivo?: boolean, pipe?: boolean, texto?: string}} entrada
 * @returns {null | {codigos: {valor: string, incerto: boolean}[], origem: string}}
 *   null = não roda código inline (script em arquivo, módulo, --version...).
 */
export function codigoInline(linguagem, args, { heredocs = [], herestrings = [], entradaArquivo = false, pipe = false, texto = '' } = {}) {
  const codigos = [];
  let script = false;
  let info = false;
  if (linguagem === 'node') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const v = a.valor;
      if (a.incerto) continue; // $X: pode ser script ou opção; segue procurando -e (sem código e sem script = entrada padrão)
      if (NODE_CODIGO.has(v)) { if (args[i + 1]) codigos.push(args[i + 1]); break; }
      const m = v.match(/^--(eval|print)=([\s\S]*)$/);
      if (m) { codigos.push({ valor: m[2], incerto: a.incerto }); break; }
      if (NODE_COM_ARG.has(v)) { i++; continue; }
      if (['-v', '-h'].includes(v) || INFO_LONGA.test(v)) { info = true; break; }
      if (v === '-') break; // programa pela entrada padrão
      if (v === '--') { const p = args[i + 1]; if (p && p.valor !== '-') script = true; break; }
      if (v.startsWith('-')) continue;
      script = true;
      break;
    }
  } else if (linguagem === 'deno') {
    const sub = args[0]?.valor;
    if (sub === 'eval') {
      for (let i = 1; i < args.length; i++) {
        if (args[i].valor === '--ext') { i++; continue; }
        if (!args[i].valor.startsWith('-')) { codigos.push(args[i]); break; }
      }
    } else if (!((sub === 'run' || sub === 'x') && args.slice(1).find((a) => !a.valor.startsWith('-'))?.valor === '-')) script = true;
  } else if (linguagem === 'bun') {
    const i = args.findIndex((a) => ['-e', '--eval', '-p', '--print'].includes(a.valor));
    if (i >= 0 && args[i + 1]) codigos.push(args[i + 1]);
    else script = true;
  } else {
    const c = CURTAS[linguagem];
    fora: for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const v = a.valor;
      if (a.incerto) continue; // $X: pode ser script ou opção; segue procurando -c/-e
      if (v === '-') break; // programa pela entrada padrão (ou argv depois do -e)
      if (v === '--') { const p = args[i + 1]; if (!codigos.length && p && p.valor !== '-') script = true; break; }
      if (INFO_LONGA.test(v)) { info = true; break; }
      if (v.startsWith('--')) continue;
      if (!v.startsWith('-')) { if (!codigos.length) script = true; break; } // depois do -e: arquivos de entrada/argv
      for (let k = 1; k < v.length; k++) {
        const l = v[k];
        const resto = v.slice(k + 1);
        if (c.codigo.includes(l)) {
          const t = resto ? { valor: resto, incerto: a.incerto } : args[++i];
          if (t) codigos.push(t);
          if (c.para) break fora;
          break;
        }
        if (c.script.includes(l)) { script = true; break fora; }
        if (c.comArg.includes(l)) { if (!resto) i++; break; }
        if (c.colado.includes(l)) break;
        if (c.digitos.includes(l)) { while (/\d/.test(v[k + 1] || '')) k++; continue; }
        if (c.info.includes(l) && k === 1 && v.length === 2) { info = true; break fora; }
      }
    }
  }
  if (codigos.length) return { codigos, origem: 'código na linha de comando' };
  if (script || info) return null;
  // Sem código e sem script: o programa vem da entrada padrão (here-doc, here-string, pipe).
  const doStdin = [...heredocs.map((h) => ({ valor: h.corpo, incerto: h.incerto })), ...herestrings];
  if (doStdin.length) return { codigos: doStdin, origem: 'here-doc/here-string' };
  if (entradaArquivo || !pipe) return null; // python3 < script.py: script em arquivo; sem pipe: nada a executar
  // Pipe (echo "..." | python3): o comando inteiro é o código (o que gera a entrada está nele).
  return { codigos: [{ valor: texto, incerto: false }], origem: 'pipe' };
}

// ───────────────────────────── leitura do código ─────────────────────────────

/** Fim do literal de texto que começa em i (aspas simples, duplas, crase; triplas do Python). */
function fimDoTexto(s, i) {
  const q = s[i];
  const triplo = q !== '`' && s.startsWith(q.repeat(3), i);
  const fecha = triplo ? q.repeat(3) : q;
  let j = i + fecha.length;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s.startsWith(fecha, j)) return j + fecha.length;
    j++;
  }
  return s.length;
}

const ABRE = { '(': ')', '[': ']', '{': '}' };

/**
 * Lê uma expressão a partir de i até um separador no nível 0 (paradas: conjunto de caracteres; `fecha`: o
 * parêntese que encerra a lista). Retorna {texto, fim}.
 */
function lerAte(s, i, paradas, palavrasDeParada = null) {
  const pilha = [];
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = fimDoTexto(s, j); continue; }
    if (ABRE[c]) { pilha.push(ABRE[c]); j++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (!pilha.length) break;
      pilha.pop();
      j++;
      continue;
    }
    if (!pilha.length) {
      if (paradas.includes(c)) break;
      if (palavrasDeParada && palavrasDeParada.test(s.slice(j))) break;
    }
    j++;
  }
  return { texto: s.slice(i, j), fim: j };
}

/** Argumentos de uma chamada cujo "(" está em i: [{texto}] e o fim (depois do ")"). */
function argumentos(s, i) {
  const lista = [];
  let j = i + 1;
  for (;;) {
    const r = lerAte(s, j, ',');
    if (r.texto.trim()) lista.push(r.texto.trim());
    j = r.fim;
    if (s[j] === ',') { j++; continue; }
    break;
  }
  return { lista, fim: j + 1 };
}

/** Argumentos de chamada sem parênteses (perl/ruby): até ; ou fim de linha, "or", "unless", "if", "||", "do". */
const FIM_SEM_PARENTESES = /^(\s+(or|and|unless|if|do)\b|\|\||&&)/;
function argumentosSemParenteses(s, i) {
  const lista = [];
  let j = i;
  for (;;) {
    const r = lerAte(s, j, ',;\n', FIM_SEM_PARENTESES);
    if (r.texto.trim()) lista.push(r.texto.trim());
    j = r.fim;
    if (s[j] === ',') { j++; continue; }
    break;
  }
  return lista;
}

/** Receptor de um ".metodo(" (texto antes do ponto): Path('x'), os, fs.promises, require('fs'), p... */
function receptor(s, fimReceptor) {
  let j = fimReceptor - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  const fim = j + 1;
  while (j >= 0) {
    const c = s[j];
    if (c === ')' || c === ']' || c === '}') {
      const abre = c === ')' ? '(' : c === ']' ? '[' : '{';
      let nivel = 0;
      for (; j >= 0; j--) {
        if (s[j] === c) nivel++;
        else if (s[j] === abre && --nivel === 0) break;
      }
      j--;
      continue;
    }
    if (c === '"' || c === "'") {
      const k = s.lastIndexOf(c, j - 1);
      j = k < 0 ? -1 : k - 1;
      continue;
    }
    if (/[\w$.]/.test(c)) { j--; continue; }
    if ((c === '>' && s[j - 1] === '-') || (c === ':' && s[j - 1] === ':')) { j -= 2; continue; }
    break;
  }
  return s.slice(j + 1, fim).trim();
}

/** Separa "nome=valor" (python), "nome: valor" e ":nome => valor" (ruby) dos posicionais. */
function separarArgs(lista) {
  const pos = [];
  const kw = {};
  for (const a of lista) {
    const m = a.match(/^:?([A-Za-z_]\w*)\s*(?:=(?![=>])|:(?!:)|=>)\s*([\s\S]+)$/);
    if (m && !/^['"]/.test(a)) kw[m[1]] = m[2].trim();
    else pos.push(a);
  }
  return { pos, kw };
}

// ───────────────────────────── chamadas que gravam ─────────────────────────────

// Especificação: alvos = índices dos argumentos que são caminhos gravados ('todos', 'resto1' = do 1 em diante,
// 'resto2'); modo = índice do argumento de modo (só grava com modo de escrita); apaga/recursivo; opaco = executa
// outro processo ou código (não dá para ver o que grava).
const E = (alvos, extra = {}) => ({ alvos, ...extra });
const OPACO = { opaco: true };
const APAGA = { apaga: true, recursivo: true };

const OS = {
  remove: E([0], APAGA), unlink: E([0], APAGA), rmdir: E([0], APAGA), removedirs: E([0], APAGA),
  mkdir: E([0]), makedirs: E([0]), rename: E([0, 1]), renames: E([0, 1]), replace: E([0, 1]), truncate: E([0]),
  chmod: E([0]), chown: E([0]), lchown: E([0]), lchmod: E([0]), utime: E([0]), chflags: E([0]), mkfifo: E([0]),
  mknod: E([0]), symlink: E([1]), link: E([1]), open: E([0], { modo: 1, tipoModo: 'flags' }),
};
const OS_OPACO = /^(system|popen|exec\w*|spawn\w*|posix_spawn\w*|startfile|execute|fork\w*)$/;
const SHUTIL = {
  copy: E([1]), copy2: E([1]), copyfile: E([1]), copymode: E([1]), copystat: E([1]), copytree: E([1], { recursivo: true }),
  move: E([0, 1], { recursivo: true }), rmtree: E([0], APAGA), chown: E([0]), make_archive: E([0]),
  unpack_archive: E([1], { recursivo: true, padrao: "'.'" }),
};
const IO = { open: E([0], { modo: 1 }), output: E([0]), popen: OPACO, sysopen: E([0], { modo: 1 }) };
const FS = {
  writeFile: E([0]), appendFile: E([0]), createWriteStream: E([0]), truncate: E([0]), rm: E([0], APAGA),
  rmdir: E([0], APAGA), unlink: E([0], APAGA), mkdir: E([0]), mkdtemp: E([0]), chmod: E([0]), lchmod: E([0]),
  chown: E([0]), lchown: E([0]), utimes: E([0]), lutimes: E([0]), outputFile: E([0]), outputJson: E([0]),
  outputJSON: E([0]), writeJson: E([0]), writeJSON: E([0]), remove: E([0], APAGA), emptyDir: E([0], APAGA),
  ensureFile: E([0]), ensureDir: E([0]), mkdirp: E([0]), mkdirs: E([0]), rename: E([0, 1]), move: E([0, 1]),
  copyFile: E([1]), cp: E([1], { recursivo: true }), copy: E([1], { recursivo: true }), symlink: E([1]), link: E([1]),
  open: E([0], { modo: 1 }),
};
/** Nomes do fs que, sozinhos (desestruturados), são inconfundíveis: writeFile, appendFile, *Sync... */
const FS_GENERICOS = new Set(['rm', 'rmdir', 'unlink', 'mkdir', 'chmod', 'chown', 'utimes', 'rename', 'move', 'copy', 'cp', 'link', 'symlink', 'open', 'truncate', 'remove', 'lchmod', 'lchown', 'lutimes', 'emptyDir']);
const DENO = {
  writeTextFile: E([0]), writeFile: E([0]), truncate: E([0]), mkdir: E([0]), chmod: E([0]), chown: E([0]),
  utime: E([0]), create: E([0]), remove: E([0], APAGA), rename: E([0, 1]), copyFile: E([1]), symlink: E([1]),
  link: E([1]), open: E([0], { modo: 1, tipoModo: 'opcoes' }), makeTempFile: E([]), makeTempDir: E([]),
  Command: OPACO, run: OPACO,
};
const BUN = { write: E([0]), spawn: OPACO, spawnSync: OPACO, $: OPACO };
const RB_FILE = {
  write: E([0]), binwrite: E([0]), open: E([0], { modo: 1 }), new: E([0], { modo: 1 }), delete: E('todos', APAGA),
  unlink: E('todos', APAGA), rename: E([0, 1]), symlink: E([1]), link: E([1]), chmod: E('resto1'), lchmod: E('resto1'),
  chown: E('resto2'), lchown: E('resto2'), utime: E('resto2'), truncate: E([0]), mkfifo: E([0]),
  sysopen: E([0], { modo: 1, tipoModo: 'flags' }), popen: OPACO,
};
const RB_DIR = { mkdir: E([0]), rmdir: E([0], APAGA), delete: E([0], APAGA), unlink: E([0], APAGA) };
const RB_FILEUTILS = {
  rm: E('todos', APAGA), rm_f: E('todos', APAGA), rm_r: E('todos', APAGA), rm_rf: E('todos', APAGA),
  rmtree: E('todos', APAGA), remove: E('todos', APAGA), remove_dir: E('todos', APAGA), remove_entry: E('todos', APAGA),
  remove_entry_secure: E('todos', APAGA), remove_file: E('todos', APAGA), rmdir: E('todos', APAGA), mkdir: E('todos'),
  mkdir_p: E('todos'), makedirs: E('todos'), mkpath: E('todos'), touch: E('todos'), chmod: E('resto1'),
  chmod_R: E('resto1', { recursivo: true }), chown: E('resto2'), chown_R: E('resto2', { recursivo: true }),
  cp: E([1]), cp_r: E([1], { recursivo: true }), cp_lr: E([1], { recursivo: true }), copy: E([1]), copy_file: E([1]),
  copy_entry: E([1], { recursivo: true }), install: E([1]), ln: E([1]), ln_s: E([1]), ln_sf: E([1]), symlink: E([1]),
  link: E([1]), mv: E([0, 1], { recursivo: true }), move: E([0, 1], { recursivo: true }),
};
/** Receptor (módulo) → tabela. */
function tabelaDoModulo(r, linguagem) {
  if (linguagem === 'python') {
    if (r === 'os' || r === 'posix') return OS;
    if (r === 'shutil') return SHUTIL;
    if (r === 'io' || r === 'codecs') return IO;
  }
  if (linguagem === 'lua') {
    if (r === 'os') return OS;
    if (r === 'io') return IO;
  }
  if (linguagem === 'node' || linguagem === 'deno' || linguagem === 'bun') {
    if (/^(fs\w*|\w*[Ff]s|promises|\w+\.promises|require\(['"](node:)?fs(-extra)?(\/promises)?['"]\)(\.promises)?)$/.test(r)) return FS;
    if (r === 'Deno') return DENO;
    if (r === 'Bun') return BUN;
  }
  if (linguagem === 'ruby') {
    if (r === 'File' || r === 'IO') return RB_FILE;
    if (r === 'Dir') return RB_DIR;
    if (r === 'FileUtils') return RB_FILEUTILS;
  }
  return null;
}

/** Módulos que executam outro processo ou código: qualquer método é opaco. */
const MODULO_OPACO = /^(subprocess|pty|ctypes|importlib|cp|child_process|childProcess|require\(['"](node:)?child_process['"]\)|vm|Open3|Process|Kernel|PTY)$/;

/** Funções soltas por linguagem (perl e php não têm módulo; python: open, exec...). */
const PERL = {
  unlink: E('todos', APAGA), rmdir: E('todos', APAGA), mkdir: E([0]), chmod: E('resto1'), chown: E('resto2'),
  utime: E('resto2'), truncate: E([0]), rename: E([0, 1]), link: E([1]), symlink: E([1]), system: OPACO, exec: OPACO,
  copy: E([1]), cp: E([1]), move: E([0, 1]), mv: E([0, 1]), make_path: E('todos'), mkpath: E('todos'),
  remove_tree: E('todos', APAGA), rmtree: E('todos', APAGA), write_file: E([0]), write_text: E([0]),
  sysopen: E([1], { modo: 2, tipoModo: 'flags' }), eval: OPACO,
};
const PHP = {
  file_put_contents: E([0]), fopen: E([0], { modo: 1 }), unlink: E([0], APAGA), rename: E([0, 1]), copy: E([1]),
  mkdir: E([0]), rmdir: E([0], APAGA), touch: E([0]), chmod: E([0]), chown: E([0]), symlink: E([1]), link: E([1]),
  system: OPACO, exec: OPACO, shell_exec: OPACO, passthru: OPACO, popen: OPACO, proc_open: OPACO, pcntl_exec: OPACO,
  eval: OPACO,
};
const SOLTAS = {
  python: { open: E([0], { modo: 1 }), exec: OPACO, eval: OPACO, compile: OPACO, __import__: OPACO, execfile: OPACO },
  node: { eval: OPACO, Function: OPACO, exec: OPACO, execSync: OPACO, execFile: OPACO, execFileSync: OPACO, spawn: OPACO, spawnSync: OPACO, fork: OPACO },
  deno: { eval: OPACO, Function: OPACO },
  bun: { eval: OPACO, Function: OPACO },
  perl: PERL,
  ruby: { system: OPACO, exec: OPACO, spawn: OPACO, eval: OPACO, open: E([0], { modo: 1, pipe: true }), instance_eval: OPACO, send: OPACO },
  php: PHP,
  lua: { dofile: OPACO, loadstring: OPACO, load: OPACO, loadfile: OPACO },
};
/** Métodos de objeto-caminho (pathlib.Path, Pathname, Path::Tiny): o receptor é o caminho gravado. */
const METODOS_DE_CAMINHO = {
  write_text: E([]), write_bytes: E([]), touch: E([]), mkdir: E([]), rmdir: E([], APAGA), unlink: E([], APAGA),
  chmod: E([]), lchmod: E([]), symlink_to: E([]), hardlink_to: E([]), rename: E([0], { soPath: true }), replace: E([0], { soPath: true }),
  open: E([], { modo: 0, soPath: true }), write: E([], { soPath: true }), binwrite: E([], { soPath: true }), delete: E([], { soPath: true, ...APAGA }),
  mkpath: E([]), rmtree: E([], APAGA), make_symlink: E([]), make_link: E([]), spew: E([]), spew_utf8: E([]),
  spew_raw: E([]), append: E([], { soPath: true }), append_utf8: E([]), append_raw: E([]), remove: E([], { soPath: true, ...APAGA }),
  remove_tree: E([], APAGA), move: E([0], { soPath: true }), copy: E([0], { soPath: true }),
};
const PARECE_PATH = /^(?:(?:pathlib\.)?(?:Pure)?(?:Posix|Windows)?Path|Pathname(?:\.new)?|path)\s*\(/;

/** Sinais no texto de execução de outro processo/código (o que ele grava não aparece). */
const SINAL_OPACO = /\bchild_process\b|\bsubprocess\b|\bos\s*\.\s*(system|popen|exec\w*|spawn\w*|posix_spawn)\b|\bpty\s*\.\s*spawn|\bctypes\b|\bimportlib\b|\b__import__\b|\bgetattr\s*\(\s*(os|shutil|io|pathlib|fs|builtins)\b|\bbuiltins\b|\bvm\s*\.\s*run|\bnew\s+Function\b|\bprocess\s*\.\s*(binding|dlopen)\b|\bDeno\s*\.\s*(Command|run)\b|\bBun\s*\.\s*(spawn|\$)|\bOpen3\b|\bIO\s*\.\s*popen\b|%x[({[]|\bqx\s*[({[/|]|\bpcntl_exec\b|\bproc_open\b|\bshell_exec\b|\bos\s*\.\s*execute\b|\bio\s*\.\s*popen\b/;
const CHDIR = /\bchdir\b|\bprocess\s*\.\s*chdir\b|\bDir\s*\.\s*chdir\b/;

// ───────────────────────────── resolução de caminhos ─────────────────────────────

/** Texto literal (string, null = interpolado, undefined = não é literal). */
function literalDe(e, linguagem) {
  let m;
  if (linguagem === 'python') {
    m = e.match(/^([rRbBuUfF]{0,2})('''|"""|'|")/);
    if (!m) return undefined;
    const ini = m[1].length;
    if (fimDoTexto(e, ini) !== e.length) return undefined;
    const q = m[2];
    const corpo = e.slice(ini + q.length, e.length - q.length);
    if (/[fF]/.test(m[1]) && corpo.includes('{')) return null;
    return /[rR]/.test(m[1]) ? corpo : corpo.replace(/\\(.)/g, '$1');
  }
  if (linguagem === 'lua' && (m = e.match(/^\[(=*)\[([\s\S]*)\]\1\]$/))) return m[2];
  const q = e[0];
  if (q !== '"' && q !== "'" && q !== '`') return undefined;
  if (fimDoTexto(e, 0) !== e.length) return undefined;
  const corpo = e.slice(1, -1);
  if (q === '`') {
    if (linguagem === 'node' || linguagem === 'deno' || linguagem === 'bun') return corpo.includes('${') ? null : corpo;
    return null; // crase em perl/ruby/php executa comando
  }
  if (q === '"') {
    if ((linguagem === 'perl' || linguagem === 'php') && /[$@]/.test(corpo)) return null;
    if (linguagem === 'ruby' && corpo.includes('#{')) return null;
  }
  return corpo.replace(/\\(.)/g, '$1');
}

/** Divide e no nível 0 pelo operador (só fora de textos e parênteses). */
function dividirTopo(e, op) {
  const partes = [];
  let ini = 0;
  const pilha = [];
  for (let j = 0; j < e.length; j++) {
    const c = e[j];
    if (c === '"' || c === "'" || c === '`') { j = fimDoTexto(e, j) - 1; continue; }
    if (ABRE[c]) { pilha.push(c); continue; }
    if (c === ')' || c === ']' || c === '}') { pilha.pop(); continue; }
    if (!pilha.length && c === op && e[j + 1] !== '=' && e[j + 1] !== op && e[j - 1] !== op) { partes.push(e.slice(ini, j)); ini = j + 1; }
  }
  partes.push(e.slice(ini));
  return partes.map((p) => p.trim());
}

const JUNTA = /^(os\.path\.join|posixpath\.join|path\.join|path\.posix\.join|posix\.join|join|path\.resolve|resolve|(?:pathlib\.)?(?:Pure)?(?:Posix)?Path|Pathname(?:\.new)?|File\.join|File\.expand_path|os\.path\.abspath|os\.path\.normpath|os\.path\.realpath|abspath|normpath|realpath|str|String|os\.fspath|path\.normalize|normalize|path|catfile|File::Spec->catfile)$/;
const CWD = /^(process\.cwd\(\)|os\.getcwd\(\)|(?:pathlib\.)?Path\.cwd\(\)|Dir\.pwd|Deno\.cwd\(\)|__dirname|import\.meta\.dirname|getcwd\(\)|Cwd::getcwd\(\)|cwd\(\))$/;
const TMP = /^(tempfile\.(gettempdir|mkdtemp)\([^)]*\)|os\.tmpdir\(\)|tmpdir\(\)|Dir\.tmpdir|sys_get_temp_dir\(\)|Deno\.makeTempDirSync\(\)|File::Spec->tmpdir)$/;
const SUFIXOS = /\.(resolve|absolute|expanduser|toString|to_s|to_path|as_posix|freeze)\s*(\(\s*\))?$/;
const parece = (s) => !/[\s'"\n\0]/.test(s) && s.length < 300 && (/[/\\]/.test(s) || /\.[A-Za-z0-9]{1,8}$/.test(s));

/** Índice logo depois do fechamento do grupo ( [ { que abre em i (pula textos). */
function fimDoGrupo(s, i) {
  const pilha = [];
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = fimDoTexto(s, j) - 1; continue; }
    if (ABRE[c]) { pilha.push(ABRE[c]); continue; }
    if (c === ')' || c === ']' || c === '}') {
      pilha.pop();
      if (!pilha.length) return j + 1;
    }
  }
  return -1;
}
/** a / b e join(a, b): b absoluto descarta a (como os.path.join, pathlib e path.resolve). */
const juntar = (a, b) => (/^([A-Za-z]:)?\//.test(barras(b)) ? b : posix.join(a, b));

/**
 * Caminhos possíveis da expressão (lista) ou null quando não dá para determinar.
 * ctx: {codigo, linguagem, existe(v)}.
 */
function resolver(expr, ctx, prof = 0) {
  if (prof > 6) return null;
  let e = String(expr).trim();
  while (SUFIXOS.test(e)) e = e.replace(SUFIXOS, '').trim();
  if (!e) return null;
  if (e.startsWith('(') && fimDoGrupo(e, 0) === e.length) {
    const dentro = e.slice(1, -1);
    if (dividirTopo(dentro, ',').filter(Boolean).length > 1) return lista(dentro, ctx, prof);
    return resolver(dentro, ctx, prof + 1);
  }
  const lit = literalDe(e, ctx.linguagem);
  if (lit !== undefined) return lit === null ? null : [lit];
  if (CWD.test(e)) return ['.'];
  if (TMP.test(e)) return [barras(tmpdir())];
  if ((e.startsWith('[') || (e.startsWith('{') && ctx.linguagem === 'python')) && fimDoGrupo(e, 0) === e.length) {
    return lista(e.slice(1, -1), ctx, prof);
  }
  if (ctx.linguagem === 'python') {
    const partes = dividirTopo(e, '/');
    if (partes.length > 1) return combinar(partes, ctx, prof, juntar);
  }
  if (ctx.linguagem !== 'perl' && ctx.linguagem !== 'php') {
    const partes = dividirTopo(e, '+');
    if (partes.length > 1) return combinar(partes, ctx, prof, (a, b) => a + b);
  }
  e = e.replace(/^require\(\s*['"](?:node:)?path['"]\s*\)\s*\./, 'path.'); // require('path').join(...)
  const chamada = e.match(/^([\w$.:]+(?:->\w+)?)\s*\(/);
  if (chamada && fimDoGrupo(e, chamada[0].length - 1) === e.length) {
    const nome = chamada[1];
    if (!JUNTA.test(nome)) return null;
    const { lista: args } = argumentos(e, chamada[0].length - 1);
    if (!args.length) return ['.'];
    const unir = /resolve$|join$|Path$|Pathname|catfile|^path$/.test(nome) ? juntar : (a) => a;
    return combinar(args, ctx, prof, unir);
  }
  if (/^\$?[A-Za-z_]\w*$/.test(e)) return variavel(e, ctx, prof);
  return null;
}

function lista(texto, ctx, prof) {
  const itens = dividirTopo(texto, ',').filter(Boolean);
  const res = [];
  for (const it of itens) {
    const r = resolver(it, ctx, prof + 1);
    if (r === null) return null;
    // de uma lista (for p in [...], tupla), só o que parece caminho: o resto é conteúdo (texto a trocar etc.)
    res.push(...r.filter((s) => parece(s) || ctx.existe(s)));
  }
  return res;
}

function combinar(partes, ctx, prof, unir) {
  let acc = null;
  for (const p of partes) {
    const r = resolver(p, ctx, prof + 1);
    if (r === null) return null;
    acc = acc === null ? r : acc.flatMap((a) => r.map((b) => unir(a, b)));
    if (acc.length > 200) return null;
  }
  return acc;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Valores possíveis de uma variável: todas as atribuições literais (e listas de for) do código. */
function variavel(nome, ctx, prof) {
  const s = ctx.codigo;
  const n = escapar(nome);
  const valores = [];
  let achou = false;
  const atrib = new RegExp(`(?:^|[\\s;{(,])(?:(?:const|let|var|my|our|local|global)\\s+)?${n}\\s*(\\+=|\\.=|\\|\\|=|\\?\\?=|&&=|//=|:=|=)(?![=~>])`, 'g');
  let m;
  while ((m = atrib.exec(s))) {
    if (m[1] !== '=' && m[1] !== ':=') return null; // p += 'x', p .= ...: não dá para seguir
    const ini = m.index + m[0].length;
    const paradas = ctx.linguagem === 'node' || ctx.linguagem === 'deno' || ctx.linguagem === 'bun' ? ';\n,' : ';\n';
    const { texto } = lerAte(s, ini, paradas);
    achou = true;
    const r = resolver(texto, ctx, prof + 1);
    if (r === null) return null;
    valores.push(...r);
  }
  // for p in [...]: (python) · for (const p of [...]) (js) · [...].each do |p| (ruby) · for my $p (...) (perl)
  const lacos = [
    new RegExp(`\\bfor\\s+[\\w\\s,()]{0,80}?(?<![\\w$])${n}\\b[\\w\\s,()]{0,80}?\\s+in\\s+`, 'g'),
    new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)?\\s*[\\w\\s,{}\\[\\]]{0,80}?(?<![\\w$])${n}\\b[\\w\\s,{}\\[\\]]{0,80}?\\s+of\\s+`, 'g'),
    new RegExp(`\\bfor(?:each)?\\s+(?:my\\s+)?${n}\\s*(?=\\()`, 'g'),
  ];
  for (const re of lacos) {
    while ((m = re.exec(s))) {
      achou = true;
      const ini = m.index + m[0].length;
      const { texto } = ctx.linguagem === 'perl' ? { texto: s.slice(ini, lerAte(s, ini + 1, '').fim + 1) } : lerAte(s, ini, ':;\n', /^\s+if\b/);
      const r = resolver(texto.trim(), ctx, prof + 1);
      if (r === null) return null;
      valores.push(...r);
    }
  }
  const rb = new RegExp(`(\\[[^\\]]*\\]|%w[[(][^\\])]*[\\])]|[\\w.]+)\\s*\\.\\s*each\\w*\\s*(?:do\\s*\\||\\{\\s*\\|)\\s*${n}\\s*\\|`, 'g');
  while ((m = rb.exec(s))) {
    achou = true;
    const w = m[1].match(/^%w[[(]([^\])]*)[\])]$/);
    const r = w ? w[1].trim().split(/\s+/) : resolver(m[1], ctx, prof + 1);
    if (r === null) return null;
    valores.push(...r);
  }
  return achou ? valores : null;
}

/** O modo/flags do open grava? (sem modo = leitura; modo que não dá para resolver = grava). */
function modoGrava(arg, tipo, ctx) {
  if (arg === undefined) return false;
  if (tipo === 'flags') return !/^[\s\w.|]*O_RDONLY[\s\w.]*$/.test(arg) || /O_(WRONLY|RDWR|CREAT|APPEND|TRUNC)/.test(arg);
  if (tipo === 'opcoes') return /write|append|create|truncate/.test(arg);
  const r = resolver(arg, ctx);
  if (r === null) return true;
  return r.some((m) => /[waxc+]/.test(m.replace(/^\|.*/, '')) || /\|/.test(m));
}

/** Índices de alvo → expressões. */
function expressoesAlvo(spec, pos, kw) {
  if (spec.alvos === 'todos') return pos.slice();
  if (spec.alvos === 'resto1') return pos.slice(1);
  if (spec.alvos === 'resto2') return pos.slice(2);
  return spec.alvos
    .map((i) => pos[i] ?? (i === 0 ? kw.file ?? kw.path ?? kw.src : kw.dst ?? kw.dest ?? kw.target) ?? spec.padrao)
    .filter((x) => x !== undefined);
}

// ───────────────────────────── análise ─────────────────────────────

/**
 * Escritas do código inline (função pura).
 * @param {string} codigo
 * @param {string} linguagem
 * @param {{existe?: (v: string) => boolean, home?: string}} [opcoes]
 * @returns {{alvos: {valor: string, apaga: boolean, recursivo: boolean}[], indeterminados: string[]}}
 *   indeterminados: motivos de escrita cujo caminho não dá para determinar (ou execução de outro processo).
 */
export function escritasDoCodigo(codigo, linguagem, { existe = () => false, home = homedir() } = {}) {
  const s = String(codigo);
  const ctx = { codigo: s, linguagem, existe };
  const alvos = [];
  const indeterminados = [];
  if (s.length > 100000) return { alvos, indeterminados: ['código inline grande demais para conferir'] };
  const sinal = s.match(SINAL_OPACO);
  if (sinal) indeterminados.push(`executa outro processo ou código (${sinal[0].trim()})`);
  if (['perl', 'ruby', 'php'].includes(linguagem) && /`/.test(s)) indeterminados.push('executa comando entre crases');
  const relativoIncerto = CHDIR.test(s);
  const anotar = (spec, exprs, onde) => {
    for (const ex of exprs) {
      const r = resolver(ex, ctx);
      if (r === null) { indeterminados.push(`${onde}(${ex.length > 60 ? `${ex.slice(0, 57)}...` : ex})`); continue; }
      for (let v of r) {
        if (!v || /[\n\0]/.test(v)) continue;
        if (v === '~' || v.startsWith('~/')) v = `${barras(home)}${v.slice(1)}`;
        if (/^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$|^-$/.test(v)) continue;
        if (relativoIncerto && !/^([A-Za-z]:)?\//.test(barras(v))) { indeterminados.push(`${onde}("${v}") depois de chdir`); continue; }
        alvos.push({ valor: v, apaga: !!spec.apaga, recursivo: !!spec.recursivo });
      }
    }
  };
  const aplicar = (spec, nome, argsTexto) => {
    if (!spec) return;
    if (spec.opaco) { indeterminados.push(`executa outro processo ou código (${nome})`); return; }
    const { pos, kw } = separarArgs(argsTexto);
    if (spec.modo !== undefined) {
      const m = pos[spec.modo] ?? kw.mode ?? kw.flag ?? kw.flags;
      if (spec.pipe && /^['"]\|/.test(pos[0] || '')) { indeterminados.push(`executa comando (${nome} com "|")`); return; }
      if (!modoGrava(m, spec.tipoModo, ctx)) return;
    }
    anotar(spec, expressoesAlvo(spec, pos, kw), `${nome}`);
  };

  // perl: open(FH, '>', p) / open(FH, ">p") / open my $fh, '>>', $p (com ou sem parênteses)
  const abrirPerl = (args) => {
    if (args.length >= 3) {
      const modo = resolver(args[1], ctx);
      if (modo !== null && modo.every((m) => /^\s*<\s*$/.test(m) || /^\s*<:/.test(m))) return;
      if (modo !== null && modo.some((m) => m.includes('|'))) { indeterminados.push('executa comando (open com "|")'); return; }
      anotar({}, [args[2]], 'open');
      return;
    }
    if (args.length === 2) {
      const r = resolver(args[1], ctx);
      if (r === null) { indeterminados.push(`open(${args[1]})`); return; }
      for (const v of r) {
        if (/^\s*\||\|\s*$/.test(v)) { indeterminados.push('executa comando (open com "|")'); continue; }
        const w = v.match(/^\s*(\+?>{1,2}|\+<)\s*(.+?)\s*$/);
        if (w) anotar({}, [JSON.stringify(w[2])], 'open');
      }
    }
  };

  // 1) chamadas com parênteses: nome( e .metodo(
  const re = /(?<![\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    const nome = m[1];
    const iParen = m.index + m[0].length - 1;
    let k = m.index - 1;
    while (k >= 0 && /[ \t]/.test(s[k])) k--;
    const ehMetodo = s[k] === '.' || (s[k] === '>' && s[k - 1] === '-') || (s[k] === ':' && s[k - 1] === ':');
    if (!ehMetodo && /^(def|function|sub|fn|class|if|while|for|elif|return|print|and|or|not|in|lambda|catch|switch|with|typeof)$/.test(nome)) continue;
    if (!ehMetodo && k >= 0 && /\bdef\s*$|\bfunction\s*$|\bsub\s*$/.test(s.slice(Math.max(0, k - 10), k + 1))) continue;
    const { lista: args } = argumentos(s, iParen);
    if (!ehMetodo) {
      if (linguagem === 'perl' && nome === 'open') { abrirPerl(args); continue; }
      const soltas = SOLTAS[linguagem] || {};
      let spec = Object.hasOwn(soltas, nome) ? soltas[nome] : undefined;
      if (!spec && (linguagem === 'node' || linguagem === 'deno' || linguagem === 'bun')) {
        const base = nome.replace(/Sync$/, '');
        if (Object.hasOwn(FS, base) && (nome.endsWith('Sync') || !FS_GENERICOS.has(base))) spec = FS[base];
      }
      aplicar(spec, nome, args);
      continue;
    }
    const rec = receptor(s, s[k] === '.' ? k : k - 1);
    const recN = rec.replace(/\s+/g, '');
    if (MODULO_OPACO.test(recN)) { indeterminados.push(`executa outro processo ou código (${recN}.${nome})`); continue; }
    const tabela = tabelaDoModulo(recN, linguagem);
    const base = nome.replace(/Sync$/, '');
    if (tabela) {
      if ((linguagem === 'python' || linguagem === 'lua') && tabela === OS && OS_OPACO.test(nome)) { indeterminados.push(`executa outro processo (${rec}.${nome})`); continue; }
      const chave = tabela === FS || tabela === DENO ? base : nome;
      if (Object.hasOwn(tabela, chave)) aplicar(tabela[chave], `${rec}.${nome}`, args);
      continue;
    }
    if (/^(os\.path|path|posixpath|sys|json|re|console|Math|JSON|Object|Array|String|Number|Promise|Buffer)$/.test(recN)) continue;
    if ((linguagem === 'node' || linguagem === 'deno' || linguagem === 'bun') && Object.hasOwn(FS, base) && (nome.endsWith('Sync') || !FS_GENERICOS.has(base))) {
      aplicar(FS[base], `${rec}.${nome}`, args); // import * as x from 'fs'; x.writeFileSync(...)
      continue;
    }
    if (linguagem === 'node' || linguagem === 'deno' || linguagem === 'bun' || linguagem === 'php' || linguagem === 'lua') continue;
    const mc = Object.hasOwn(METODOS_DE_CAMINHO, nome) ? METODOS_DE_CAMINHO[nome] : null;
    if (!mc) continue;
    // write/delete/replace/move... só em objeto-caminho evidente: Path(...), Pathname(...), path(...) ou variável dele.
    const ehPath = PARECE_PATH.test(rec) || (/^\$?\w+$/.test(rec) && new RegExp(`(?:^|[\\s;(,])${escapar(rec)}\\s*=\\s*(?:pathlib\\.)?(?:Pure)?(?:Posix)?(?:Path|Pathname)\\b|${escapar(rec)}\\s*=\\s*path\\s*\\(`).test(s));
    if (mc.soPath && !ehPath) continue;
    if (mc.modo !== undefined) {
      const { pos, kw } = separarArgs(args);
      if (!modoGrava(pos[mc.modo] ?? kw.mode, undefined, ctx)) continue;
    }
    // o próprio objeto-caminho é o alvo (Path('x').write_text, p.unlink...); rename/replace: também o destino
    anotar(mc, [rec], `.${nome}() em `);
    const { pos } = separarArgs(args);
    anotar(mc, mc.alvos.map((i) => pos[i]).filter(Boolean), `.${nome}`);
  }

  // 2) perl/ruby sem parênteses: unlink 'x'; open my $fh, '>', $p; File.write 'x', y; FileUtils.rm_rf 'x'
  if (linguagem === 'perl' || linguagem === 'ruby') {
    const nomes = linguagem === 'perl' ? Object.keys(PERL).concat('open') : ['system', 'exec', 'spawn', 'open'];
    const reSem = new RegExp(`(?<![\\w$>.:])(${nomes.join('|')})\\s+(?![=(,;)]|or\\b|and\\b)`, 'g');
    while ((m = reSem.exec(s))) {
      const args = argumentosSemParenteses(s, m.index + m[0].length);
      if (!args.length) continue;
      if (m[1] === 'open' && linguagem === 'perl') { abrirPerl(args); continue; }
      aplicar((linguagem === 'perl' ? PERL : SOLTAS.ruby)[m[1]], m[1], args);
    }
    if (linguagem === 'ruby') {
      const reMod = /(?<![\w$])(File|IO|Dir|FileUtils)\s*\.\s*(\w+)\s+(?![=(,;)])/g;
      while ((m = reMod.exec(s))) {
        const tabela = tabelaDoModulo(m[1], 'ruby');
        if (!Object.hasOwn(tabela, m[2])) continue;
        aplicar(tabela[m[2]], `${m[1]}.${m[2]}`, argumentosSemParenteses(s, m.index + m[0].length));
      }
    }
  }
  // "executa outro processo" basta uma vez (o sinal no texto e a chamada dizem a mesma coisa)
  const executa = indeterminados.find((x) => x.startsWith('executa'));
  return { alvos, indeterminados: [...new Set(indeterminados.filter((x) => !x.startsWith('executa') || x === executa))] };
}

/**
 * Escritas de um comando de interpretador (python/node/...; função pura).
 * @param {{nome: string, args: {valor: string, incerto: boolean}[], heredocs?: {corpo: string, incerto: boolean}[], herestrings?: {valor: string, incerto: boolean}[], entradaArquivo?: boolean, pipe?: boolean, texto?: string, existe?: (v: string) => boolean, home?: string}} p
 * @returns {null | {linguagem: string, alvos: {valor: string, apaga: boolean, recursivo: boolean}[], indeterminados: string[]}}
 *   null: não é interpretador ou não roda código inline (script em arquivo: continua permitido).
 */
export function escritasDoInterpretador({ nome, args, heredocs = [], herestrings = [], entradaArquivo = false, pipe = false, texto = '', existe, home }) {
  const linguagem = linguagemDe(nome);
  if (!linguagem) return null;
  const inline = codigoInline(linguagem, args, { heredocs, herestrings, entradaArquivo, pipe, texto });
  if (!inline) return null;
  const alvos = [];
  const indeterminados = [];
  for (const c of inline.codigos) {
    const r = escritasDoCodigo(c.valor, linguagem, { existe, home });
    if (c.incerto && (r.alvos.length || r.indeterminados.length)) {
      // código montado pelo shell ($VAR, $(...)): o que entra no lugar não se vê
      indeterminados.push('código com $VAR/$(...) do shell e escrita');
    }
    alvos.push(...r.alvos);
    indeterminados.push(...r.indeterminados);
  }
  return { linguagem, alvos, indeterminados: [...new Set(indeterminados)] };
}
