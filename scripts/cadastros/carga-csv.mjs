#!/usr/bin/env node
/**
 * Carga dos cadastros pelos CSVs do kit (T-0026, desenho docs/desenho/T-0026.md, D10 e seção 7): cliente HTTP da mesma
 * rota do BKO, `POST /v1/cadastros/cargas`. Não abre conexão com o banco: tenant, perfil, licença, auditoria e limites
 * são os da API.
 *
 * Uso:
 *   node scripts/cadastros/carga-csv.mjs --api <url> --empresa <slug> --email <e-mail> --pasta <dir> [--validar | --gravar] [--entidade <nome> ...]
 * - Sem --gravar, valida (nada é gravado). A senha é digitada sem eco; nunca por argumento nem variável de ambiente.
 * - A pasta não pode estar dentro de um checkout do git (o arquivo real da empresa nunca vai para o repositório).
 * - Lote acima de 10 MB ou 20.000 linhas (D7): um POST por arquivo, na ordem D13.
 * - `Idempotency-Key` = SHA-256 do modo e de nome + SHA-256 de cada arquivo: repetir o comando devolve o mesmo relatório.
 * - Imprime só o relatório da API (contagens e erros por arquivo, linha, campo e código), nunca o conteúdo de uma linha.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Ordem de carga (D13), ignorados (D1), limites (D7) e cabeçalhos: cópias do SDK e do contrato de cadastros, conferidas no teste. */
export const ORDEM_CARGA = [
  'filial',
  'vendedor',
  'condicao_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
];
/** Outros nomes de arquivo aceitos para uma entidade (v0.3.6). */
export const APELIDOS = { condicoes_pagamento: 'condicao_pagamento' };
/** Arquivos que deixaram de existir na v0.3.6: não são enviados; a CLI avisa onde o conteúdo vai agora. */
export const OBSOLETOS = {
  forma_pagamento: 'condicao_pagamento',
  prazo_pagamento: 'condicao_pagamento',
  cliente_endereco: 'cliente',
};
export const IGNORADAS = ['catalogo_no', 'tabela_escalonada', 'transportadora', 'rota', 'titulo', 'nota'];
export const MAX_BYTES_LOTE = 10 * 1024 * 1024;
export const MAX_LINHAS_LOTE = 20_000;
export const MAX_ARQUIVOS_POR_POST = 16;
export const CAMPO_ARQUIVOS = 'arquivos';
export const ROTA_CARGA = '/v1/cadastros/cargas';

export class ErroUso extends Error {
  name = 'ErroUso';
}

const OPCOES_COM_VALOR = ['--api', '--empresa', '--email', '--pasta', '--entidade'];

/** Lê e valida os argumentos. `--senha` não existe de propósito. */
export function lerArgumentos(argv) {
  const op = { modo: 'validar', entidades: [] };
  let modos = 0;
  for (let i = 0; i < argv.length; i++) {
    const chave = argv[i];
    if (chave === '--validar' || chave === '--gravar') {
      op.modo = chave.slice(2);
      modos++;
      continue;
    }
    if (chave === '--senha')
      throw new ErroUso('a senha não entra por argumento: ela é pedida no terminal, sem eco');
    if (!OPCOES_COM_VALOR.includes(chave)) throw new ErroUso(`opção desconhecida: ${chave}`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) throw new ErroUso(`${chave} exige um valor`);
    if (chave === '--entidade') op.entidades.push(valor.toLowerCase());
    else op[chave.slice(2)] = valor;
    i++;
  }
  if (modos > 1) throw new ErroUso('use --validar ou --gravar, não os dois');
  if (!op.api) throw new ErroUso('--api exige a URL da API (ex.: https://erp.macuxifdv.com.br)');
  let url;
  try {
    url = new URL(op.api);
  } catch {
    throw new ErroUso('--api não é uma URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new ErroUso('--api precisa de https (http só em localhost)');
  op.api = url.origin;
  if (!op.empresa || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(op.empresa))
    throw new ErroUso('--empresa exige o slug da empresa');
  if (!op.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(op.email))
    throw new ErroUso('--email exige o e-mail de login');
  if (!op.pasta) throw new ErroUso('--pasta exige a pasta com os CSVs');
  for (const e of op.entidades)
    if (!ORDEM_CARGA.includes(e)) throw new ErroUso(`--entidade deve ser uma de: ${ORDEM_CARGA.join(', ')}`);
  return op;
}

/** Checkout do git que contém o caminho (sobe até a raiz procurando `.git`); `null` se nenhum. */
export function checkoutQueContem(caminho) {
  let atual = realpathSync(caminho);
  for (;;) {
    if (existsSync(join(atual, '.git'))) return atual;
    const pai = dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

/** A pasta existe, é pasta e está fora de qualquer checkout do git (incluindo este repositório). */
export function conferirPasta(pasta) {
  const abs = resolve(pasta);
  if (!existsSync(abs) || !statSync(abs).isDirectory())
    throw new ErroUso('--pasta não existe ou não é pasta');
  const repo = checkoutQueContem(abs);
  const este = checkoutQueContem(dirname(fileURLToPath(import.meta.url)));
  if (repo || (este && realpathSync(abs).startsWith(este + '/'))) {
    throw new ErroUso(
      '--pasta está dentro de um repositório git: copie os CSVs para uma pasta fora do repositório (o arquivo da empresa nunca vai para o git)',
    );
  }
  return realpathSync(abs);
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const baseDoNome = (nome) => nome.toLowerCase().replace(/\.csv$/, '');
const entidadeDoNome = (nome) => APELIDOS[baseDoNome(nome)] ?? baseDoNome(nome);
const obsoleto = (nome) => Object.hasOwn(OBSOLETOS, baseDoNome(nome));

/** Aviso de uma linha para cada arquivo obsoleto da pasta (que não é enviado). */
export function avisosObsoletos(pasta) {
  return readdirSync(pasta)
    .filter((n) => /\.csv$/i.test(n) && obsoleto(n) && statSync(join(pasta, n)).isFile())
    .sort((a, b) => a.localeCompare(b))
    .map((n) => `${n}: desde a v0.3.6 vai em ${OBSOLETOS[baseDoNome(n)]}.csv`);
}

/**
 * Lista os `.csv` da pasta (sem subpastas) na ordem D13; os de nome fora do escopo vão no fim, para o relatório.
 * Os obsoletos (v0.3.6) ficam de fora: `avisosObsoletos` diz onde o conteúdo vai.
 */
export function listarArquivos(pasta, entidades = []) {
  const nomes = readdirSync(pasta).filter(
    (n) => /\.csv$/i.test(n) && !obsoleto(n) && statSync(join(pasta, n)).isFile(),
  );
  const posicao = (n) => {
    const i = ORDEM_CARGA.indexOf(entidadeDoNome(n));
    return i >= 0 ? i : ORDEM_CARGA.length + (IGNORADAS.includes(entidadeDoNome(n)) ? 0 : 1);
  };
  return nomes
    .filter((n) => entidades.length === 0 || entidades.includes(entidadeDoNome(n)))
    .sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b))
    .map((nome) => {
      const bytes = readFileSync(join(pasta, nome));
      return { nome, bytes, linhas: contarLinhas(bytes) };
    });
}

/** Linhas físicas (só conta quebras; o conteúdo não é lido nem guardado). */
export function contarLinhas(bytes) {
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes.length && bytes[bytes.length - 1] !== 0x0a ? n + 1 : n;
}

/** Um POST com tudo, ou um por arquivo quando o lote passa de D7 (ou de 16 arquivos). */
export function montarLotes(arquivos) {
  const bytes = arquivos.reduce((t, a) => t + a.bytes.length, 0);
  const linhas = arquivos.reduce((t, a) => t + a.linhas, 0);
  if (bytes <= MAX_BYTES_LOTE && linhas <= MAX_LINHAS_LOTE && arquivos.length <= MAX_ARQUIVOS_POR_POST)
    return [arquivos];
  return arquivos.map((a) => [a]);
}

/** `Idempotency-Key` do lote: SHA-256 do modo e de nome + SHA-256 de cada arquivo (desenho §4). */
export function chaveIdempotencia(modo, lote) {
  return sha256(JSON.stringify([modo, ...lote.map((a) => [a.nome.toLowerCase(), sha256(a.bytes)])]));
}

export function formularioDoLote(modo, lote) {
  const f = new FormData();
  f.append('modo', modo);
  for (const a of lote) f.append(CAMPO_ARQUIVOS, new Blob([a.bytes], { type: 'text/csv' }), a.nome);
  return f;
}

async function erroHttp(r, oQue) {
  let codigo = '';
  try {
    codigo = (await r.json()).codigo ?? '';
  } catch {
    /* corpo sem JSON */
  }
  return new Error(`${oQue}: HTTP ${r.status}${codigo ? ` ${codigo}` : ''}`);
}

export async function entrar(api, empresa, email, senha, f = fetch) {
  const r = await f(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ empresa, email, senha }),
  });
  if (!r.ok) throw await erroHttp(r, 'login recusado');
  return (await r.json()).token_acesso;
}

export async function enviarLote(api, token, modo, lote, f = fetch) {
  const r = await f(`${api}${ROTA_CARGA}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': chaveIdempotencia(modo, lote) },
    body: formularioDoLote(modo, lote),
  });
  if (!r.ok) throw await erroHttp(r, 'carga recusada');
  return { relatorio: await r.json(), repetida: r.headers.get('idempotency-replayed') === 'true' };
}

const COLUNAS = ['entidade', 'situacao', 'lidas', 'inseridas', 'atualizadas', 'sem_mudanca', 'recusadas'];

/** Tabela do relatório (contagens e erros com arquivo, linha, campo, código e motivo; o relatório não traz valores, D9). */
export function formatarRelatorio(rel) {
  const linhas = [`Lote ${rel.lote_id} (${rel.modo})`];
  const tabela = [COLUNAS, ...(rel.entidades ?? []).map((e) => COLUNAS.map((c) => String(e[c] ?? '')))];
  const largura = COLUNAS.map((_, i) => Math.max(...tabela.map((l) => l[i].length)));
  for (const l of tabela)
    linhas.push(
      l
        .map((c, i) => c.padEnd(largura[i]))
        .join('  ')
        .trimEnd(),
    );
  for (const e of rel.entidades ?? []) {
    for (const a of e.avisos ?? []) linhas.push(`aviso ${e.arquivo}: ${a}`);
    if (e.colunas_ignoradas?.length)
      linhas.push(`aviso ${e.arquivo}: colunas ignoradas ${e.colunas_ignoradas.join(', ')}`);
  }
  for (const x of rel.erros ?? [])
    linhas.push(
      `erro ${x.arquivo}${x.linha === null ? '' : `:${x.linha}`}${x.campo ? ` [${x.campo}]` : ''} ${x.codigo}: ${x.motivo}`,
    );
  if (rel.erros_omitidos)
    linhas.push(`... e mais ${rel.erros_omitidos} erros (corrija os primeiros e rode de novo)`);
  return linhas.join('\n');
}

const teveRecusa = (rel) => (rel.entidades ?? []).some((e) => e.situacao === 'recusado' || e.recusadas > 0);

/** Lê a senha do terminal sem eco (só em TTY; nunca de argumento nem de variável de ambiente). */
export function lerSenha(pergunta, entrada = process.stdin, saida = process.stderr) {
  if (!entrada.isTTY)
    return Promise.reject(
      new ErroUso('a senha é pedida no terminal: rode o comando num terminal interativo'),
    );
  return new Promise((ok, falha) => {
    let senha = '';
    saida.write(pergunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const fim = (erro) => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', aoDigitar);
      saida.write('\n');
      if (erro) falha(erro);
      else ok(senha);
    };
    const aoDigitar = (txt) => {
      for (const ch of txt) {
        if (ch === '\r' || ch === '\n') return fim();
        if (ch === '\u0003') return fim(new ErroUso('cancelado'));
        if (ch === '\u007f' || ch === '\b') senha = senha.slice(0, -1);
        else senha += ch;
      }
    };
    entrada.on('data', aoDigitar);
  });
}

/** Fluxo completo; `io` é trocado nos testes (fetch, senha e saída). */
export async function executar(argv, io = {}) {
  const f = io.fetch ?? fetch;
  const escrever = io.escrever ?? ((t) => process.stdout.write(`${t}\n`));
  const op = lerArgumentos(argv);
  const pasta = conferirPasta(op.pasta);
  for (const aviso of avisosObsoletos(pasta)) escrever(`aviso ${aviso}`);
  const arquivos = listarArquivos(pasta, op.entidades);
  if (arquivos.length === 0) throw new ErroUso('nenhum .csv na pasta (ou nenhum das --entidade pedidas)');
  const lotes = montarLotes(arquivos);
  escrever(
    `${arquivos.length} arquivo(s), ${lotes.length} envio(s), modo ${op.modo}${op.modo === 'validar' ? ' (nada é gravado)' : ''}`,
  );
  const senha = await (io.senha ?? (() => lerSenha(`Senha de ${op.email}: `)))();
  const token = await entrar(op.api, op.empresa, op.email, senha, f);
  let recusa = false;
  for (const lote of lotes) {
    const { relatorio, repetida } = await enviarLote(op.api, token, op.modo, lote, f);
    if (repetida) escrever('(mesmo lote já enviado nas últimas 24 h: relatório guardado)');
    escrever(formatarRelatorio(relatorio));
    recusa ||= teveRecusa(relatorio);
  }
  return recusa ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  executar(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (e) => {
      // Só a mensagem: nada de pilha com caminho, token ou conteúdo.
      process.stderr.write(`${basename(process.argv[1])}: ${e instanceof Error ? e.message : 'falha'}\n`);
      process.exit(e instanceof ErroUso ? 2 : 1);
    },
  );
}
