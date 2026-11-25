#!/usr/bin/env node
/**
 * X-6 da v0.3.12 (T-0089): abre no Chromium TODAS as telas do web em modo de produção (next build + servidor standalone, como no Dockerfile) contra a API
 * REAL (`tests/e2e/api-render-telas.ts`: plugins de produção, Postgres local, RLS) e falha em qualquer erro de render.
 * Origem: o #564 pôs em `clientes-recebidos.tsx` (componente de servidor) funções passadas à `TabelaDensa` ('use client'); a
 * tela da Integração FDV quebrava com "Functions cannot be passed to Client Components". A fumaça das telas
 * (`tests/integracao/rotas/fumaca-telas.db.test.ts`) só chama a API e os testes de unidade usam renderToString: nenhum pegou.
 *
 * Lista de telas, sem lista à mão: todo `page.tsx` de apps/web/src/app vira uma URL; o `[modulo]/[...pagina]` do shell abre
 * cada rota de `PAGINAS_REGISTRADAS` (as duas listas vêm no JSON da API); `/config/empresas/[id]` abre a empresa de teste e
 * cada aba que a própria tela lista. Segmento dinâmico novo, sem valor aqui, derruba o e2e (a tela nova não fica fora calada).
 * Critérios de falha: X-6 de docs/testes/plano-v0.3.12.md.
 *
 * Uso: `bash tests/e2e/rodar-render-telas.sh` (sobe a API, builda e sobe o web), ou à mão:
 *   node tests/e2e/render-telas.mjs --base http://localhost:3102 --dados <json da API> --log <log do servidor web>
 * Sai 0 se todas as telas abriram limpas; 1 se alguma falhou (lista no fim). Playwright global, sem trace.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { abasDaEmpresa, argumento, entrar, urlsDasTelas } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3102');
const DADOS = argumento('dados', null);
const LOG = argumento('log', null);
/** Pasta opcional onde fica o HTML de cada tela (diagnóstico). */
const HTML = argumento('html', null);
if (!DADOS) {
  console.error(
    'uso: node tests/e2e/render-telas.mjs --base <url do web> --dados <json do api-render-telas.ts> [--log <log do servidor web>]',
  );
  process.exit(2);
}
const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
if (HTML) mkdirSync(HTML, { recursive: true });

/**
 * Marcas de erro no HTML: a página de erro do Next, os error.tsx do app e o aviso de API indisponível das telas ("Não foi
 * possível carregar ..."), que com a API real de pé quer dizer rota ausente (404 genérico) ou resposta fora do contrato.
 */
const ERRO_NO_HTML = [
  /id="__next_error__"/,
  /Application error: a (server|client)-side exception/,
  /Internal Server Error/,
  />Algo deu errado</,
  /O sistema foi atualizado\. Recarregue a página\./,
  /Não foi possível carregar[^<]*/,
];
/** Erro de render no log do servidor web (o Next de produção não manda a mensagem ao navegador). */
const ERRO_NO_LOG = /Functions cannot be passed|Only plain objects|⨯|\bError:/;

// ---------------------------------------------------------------- 1. as URLs, a partir dos page.tsx

// ---------------------------------------------------------------- 2. a vigia de cada tela

const tamanhoDoLog = () => (LOG ? statSync(LOG).size : 0);
function errosNoLogDesde(inicio) {
  if (!LOG) return [];
  const txt = readFileSync(LOG).subarray(inicio).toString('utf8');
  // O mesmo erro sai uma vez por pedaço do render: cada linha conta uma vez.
  return [
    ...new Set(
      txt
        .split('\n')
        .filter((l) => ERRO_NO_LOG.test(l))
        .map((l) => l.trim().slice(0, 300)),
    ),
  ];
}

function vigiar(pagina) {
  const v = { console: [], paginaErro: [], http5xx: [] };
  pagina.on('console', (m) => {
    if (m.type() === 'error') v.console.push(m.text().slice(0, 300));
  });
  pagina.on('pageerror', (e) =>
    v.paginaErro.push(
      String(e?.message ?? e)
        .split('\n')[0]
        .slice(0, 300),
    ),
  );
  pagina.on('response', (r) => {
    if (r.status() >= 500)
      v.http5xx.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return {
    zerar() {
      v.console.length = 0;
      v.paginaErro.length = 0;
      v.http5xx.length = 0;
    },
    v,
  };
}

const resultados = [];

async function abrir(pagina, vigia, item, rotulo = item.url) {
  const ini = Date.now();
  const logIni = tamanhoDoLog();
  vigia.zerar();
  const falhas = [];
  let status = 0;
  let final = '';
  try {
    const resp = await pagina.goto(`${BASE}${rotulo}`, { waitUntil: 'load' });
    await pagina.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    status = resp?.status() ?? 0;
    final = new URL(pagina.url()).pathname;
    const html = await pagina.content();
    if (HTML) writeFileSync(join(HTML, `${rotulo.replace(/[^a-z0-9]+/gi, '_')}.html`), html);
    const naoEncontrada = html.includes('>Página não encontrada<');
    // Rota com `:param` abre um registro fictício: a página "não encontrada" do app (200 do shell ou 404) é a resposta certa.
    const aceito404 = status === 404 && item.comParametro && naoEncontrada;
    if (status !== 200 && !aceito404) falhas.push(`status ${status}`);
    if (naoEncontrada && !item.comParametro) falhas.push(`${status} com a página "não encontrada"`);
    for (const re of ERRO_NO_HTML) {
      const m = html.match(re);
      if (m) falhas.push(`HTML com erro: ${m[0].replace(/^>|<$/g, '').slice(0, 120)}`);
    }
    if (item.contexto !== 'sem-sessao' && /^\/(login|config\/entrar)$/.test(final))
      falhas.push(`caiu no login (${final})`);
    // Com o 404 de regra aceito, o "Failed to load resource" do próprio documento não é erro de render.
    const consoleErros = vigia.v.console.filter(
      (t) => !(aceito404 && /Failed to load resource: .*404/.test(t)),
    );
    for (const t of consoleErros) falhas.push(`console: ${t}`);
    for (const t of vigia.v.paginaErro) falhas.push(`erro na página: ${t}`);
    for (const t of vigia.v.http5xx) falhas.push(`chamada ${t}`);
  } catch (e) {
    falhas.push(`navegação: ${String(e?.message ?? e).split('\n')[0]}`);
  }
  for (const l of errosNoLogDesde(logIni)) falhas.push(`log do web: ${l}`);
  const r = {
    url: rotulo,
    contexto: item.contexto,
    origem: item.origem,
    status,
    final,
    ok: falhas.length === 0,
    falhas,
    ms: Date.now() - ini,
  };
  resultados.push(r);
  console.error(
    `[render] ${r.ok ? 'ok   ' : 'FALHA'} ${String(status).padEnd(3)} ${item.contexto.padEnd(10)} ${rotulo}${final && final !== rotulo.split('?')[0] ? ` -> ${final}` : ''} (${r.ms} ms)`,
  );
  for (const f of falhas) console.error(`         - ${f}`);
}

// ---------------------------------------------------------------- 3. a rodada

const URLS = urlsDasTelas(dados);
const navegador = await chromium.launch();
const opcoes = { viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Manaus' };
let codigo = 0;
try {
  // Telas de entrada, sem sessão.
  const anon = await (await navegador.newContext(opcoes)).newPage();
  anon.setDefaultTimeout(30_000);
  const vAnon = vigiar(anon);
  for (const item of URLS.filter((u) => u.contexto === 'sem-sessao')) await abrir(anon, vAnon, item);

  // Login único (/login): o administrador do tenant de teste vai ao BKO; o superadmin (código da plataforma) ao /config.
  async function sessao(u, chegou) {
    const p = await (await navegador.newContext(opcoes)).newPage();
    p.setDefaultTimeout(30_000);
    await entrar(p, BASE, u);
    await p.waitForURL((x) => chegou(new URL(x).pathname));
    return p;
  }
  const bko = await sessao(dados.administrador, (c) => !c.startsWith('/login'));
  const vBko = vigiar(bko);
  for (const item of URLS.filter((u) => u.contexto === 'bko')) await abrir(bko, vBko, item);

  const portal = await sessao(dados.superadmin, (c) => c === '/config');
  const vPortal = vigiar(portal);
  for (const item of URLS.filter((u) => u.contexto === 'portal')) {
    await abrir(portal, vPortal, item);
    if (!item.abas) continue;
    const caminhos = await abasDaEmpresa(portal, BASE, item.url);
    if (caminhos.length === 0)
      resultados.push({
        url: item.url,
        contexto: 'portal',
        ok: false,
        falhas: ['a tela da empresa não listou nenhuma aba'],
      });
    for (const href of caminhos)
      await abrir(portal, vPortal, { ...item, abas: false, origem: `aba de ${item.url}` }, href);
  }
} catch (e) {
  console.error(`[render] FALHA fora das telas: ${String(e?.message ?? e).split('\n')[0]}`);
  codigo = 1;
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.error(
  `\n[render] ${resultados.length} telas abertas (${dados.telas.length} de PAGINAS_REGISTRADAS), ${falhas.length} com falha`,
);
for (const f of falhas) console.error(`[render] FALHA ${f.url}: ${f.falhas.join(' | ')}`);
process.exit(codigo || (falhas.length ? 1 : 0));
