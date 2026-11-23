#!/usr/bin/env node
// Trava do graphify para Read e Grep (T-0064).
// Regras e mensagens: guarda-graphify-lib.mjs; casos: guarda-graphify.test.mjs.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commonDirDe, criarRepoDe, lerMarcas, gravarMarcas, decidirRead, decidirGrep, contarLinhas,
} from './guarda-graphify-lib.mjs';

function lerEntrada() {
  return new Promise((ok) => {
    let txt = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (txt += d));
    process.stdin.on('end', () => {
      try { ok(JSON.parse(txt || '{}')); } catch { ok({}); }
    });
  });
}

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entrada = await lerEntrada();
const ferramenta = entrada.tool_name || '';
if (ferramenta !== 'Read' && ferramenta !== 'Grep') process.exit(0);
if ((entrada.hook_event_name || 'PreToolUse') !== 'PreToolUse') process.exit(0);

const comum = commonDirDe(RAIZ);
const repoDe = criarRepoDe(comum);
const sessao = entrada.session_id;
const marcas = lerMarcas(comum, sessao);
const cwd = entrada.cwd || process.cwd();
const ti = entrada.tool_input || {};

const r = ferramenta === 'Read'
  ? decidirRead({ arquivo: ti.file_path, offset: ti.offset, limit: ti.limit, cwd, marcas, repoDe, contarLinhas })
  : decidirGrep({ path: ti.path, glob: ti.glob, type: ti.type, cwd, marcas, repoDe });

if (r.marcar) gravarMarcas(comum, sessao, [r.marcar]);
if (r.mensagem) {
  process.stderr.write(r.mensagem + '\n');
  process.exit(2);
}
process.exit(0);
