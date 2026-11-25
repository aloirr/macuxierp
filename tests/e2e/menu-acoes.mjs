#!/usr/bin/env node
/**
 * T-0099 (A-1 a A-4 do plano da v0.3.13): o botão "Ações" das linhas, no Chromium, pela regra de docs/marca/botao-acoes.md.
 * O designer-ux não tem jsdom: Esc, clique fora, rolagem, setas e o alvo de 44 px só se provam aqui.
 *
 * Dois modos:
 *   --bancada [--ui <raiz do repositório com packages/ui>] --saida <pasta>
 *       monta `tests/e2e/menu-acoes-bancada.tsx` com o esbuild (o `MenuAcoes` de packages/ui, tokens.css e botoes.css),
 *       abre em arquivo local e confere o componente em 1280 e 390, com o gatilho na 1ª e na última linha visível de um
 *       quadro com `overflow`.
 *   --base <url do web> --dados <json do api-render-telas.ts> --saida <pasta>      (`MENU_ACOES=1 bash tests/e2e/rodar-render-telas.sh`)
 *       abre as telas do X-6 (mesma lista, `urlsDasTelas`), confere o 1º "Ações" de cada tela em 1280 e 390, tira o print
 *       com o menu aberto (A-4, validação do design-de-marca) e falha em "⋯" ou fileira de botões numa linha.
 *
 * Critérios (falha = linha no relatório): abre com Enter e com Espaço; setas, Home e End levam o foco aos itens habilitados;
 * Esc fecha e devolve o foco ao "Ações"; clique fora e rolagem fecham; o menu fica inteiro dentro da janela; rótulo sem
 * corte nem reticências; perigo por último, depois do traço, em #A8261B; gatilho, principal e itens com 44 px no 390.
 * Sai 0 sem falha; 1 com falha (lista no fim). Playwright global, sem trace. Só dados fictícios.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abasDaEmpresa, argumento, entrar, urlsDasTelas } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const BANCADA = process.argv.includes('--bancada');
const SAIDA = argumento('saida', null);
const BASE = argumento('base', null);
const DADOS = argumento('dados', null);
if (!SAIDA || (!BANCADA && (!BASE || !DADOS))) {
  console.error('uso: node tests/e2e/menu-acoes.mjs --bancada [--ui <raiz>] --saida <pasta>\n     node tests/e2e/menu-acoes.mjs --base <url do web> --dados <json> --saida <pasta>');
  process.exit(2);
}
mkdirSync(SAIDA, { recursive: true });

/** Regra 3 de docs/marca/botao-acoes.md: texto do item de perigo em `erroTexto` #A8261B. */
const COR_PERIGO = 'rgb(168, 38, 27)';
/** Verbos de perigo da regra (Zerar, Desativar, Excluir, Cancelar "e afins"): item com esse começo tem de vir marcado. */
const VERBO_PERIGO = /^(Zerar|Desativar|Excluir|Cancelar|Inutilizar|Apagar|Remover|Revogar|Bloquear)\b/;
const LARGURAS = [
  { nome: '1280', viewport: { width: 1280, height: 800 } },
  { nome: '390', viewport: { width: 390, height: 844 } },
];

/**
 * Caminho de um pacote do pnpm sem NODE_PATH: o hoist de `node_modules/.pnpm/node_modules`, senão a pasta
 * `node_modules/.pnpm/<nome>@<versão>/node_modules/<nome>` mais nova.
 */
function resolverPnpm(nome) {
  try {
    return require.resolve(nome, { paths: [join(RAIZ, 'node_modules/.pnpm/node_modules'), RAIZ] });
  } catch {
    const pnpm = join(RAIZ, 'node_modules/.pnpm');
    const pasta = readdirSync(pnpm).filter((d) => d.startsWith(`${nome}@`)).sort().at(-1);
    if (!pasta) throw new Error(`${nome} não encontrado em node_modules/.pnpm (rode pnpm install)`);
    return require.resolve(join(pnpm, pasta, 'node_modules', nome));
  }
}

const falhas = [];
const prints = [];
const conferidas = [];
const falhar = (onde, msg) => {
  falhas.push(`${onde}: ${msg}`);
  console.error(`[acoes] FALHA ${onde}: ${msg}`);
};

/** Estado do menu do gatilho `g` (aria-controls): visível, caixa, itens, separador e foco. */
async function estado(g) {
  return g.evaluate((el) => {
    const id = el.getAttribute('aria-controls');
    const menu = id ? document.getElementById(id) : null;
    const caixa = (e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const filhos = menu ? [...menu.children] : [];
    return {
      aberto: !!menu && el.getAttribute('aria-expanded') === 'true',
      caixa: menu ? caixa(menu) : null,
      janela: { w: window.innerWidth, h: window.innerHeight },
      focoNoGatilho: document.activeElement === el,
      focoItem: menu && document.activeElement?.getAttribute('role') === 'menuitem' ? filhos.indexOf(document.activeElement) : -1,
      filhos: filhos.map((f) => ({
        papel: f.getAttribute('role'),
        texto: (f.textContent ?? '').trim(),
        perigo: f.classList.contains('mx-acoes-perigo'),
        desabilitado: f.getAttribute('aria-disabled') === 'true' || f.hasAttribute('disabled'),
        cor: getComputedStyle(f).color,
        cortado: f.scrollWidth > f.clientWidth + 1,
        caixa: caixa(f),
      })),
      gatilho: { caixa: caixa(el), texto: (el.textContent ?? '').trim() },
    };
  });
}

/**
 * Põe o gatilho à vista antes do clique: a rolagem que o Playwright faz no clique chega depois dele e fecharia o menu
 * recém-aberto (regra 6), o que não é o uso real.
 */
async function trazerParaVista(pagina, g) {
  await g.scrollIntoViewIfNeeded();
  await pagina.waitForTimeout(150);
}

const fechado = async (g) => (await g.getAttribute('aria-expanded')) !== 'true';

/** A-1 a A-3 no gatilho `g` da página na largura `larg`; `onde` identifica a tela no relatório. */
async function conferirMenu(pagina, g, onde, larg, arquivoPrint) {
  const w = `${onde} [${larg}]`;
  await trazerParaVista(pagina, g);
  // Regra 1: o rótulo é "Ações", nunca "⋯".
  const tg = ((await g.textContent()) ?? '').trim();
  if (tg !== 'Ações') falhar(w, `gatilho com rótulo "${tg}" (esperado "Ações")`);

  // Enter abre; o foco vai a um item (de cara ou com ↓).
  await g.focus();
  await pagina.keyboard.press('Enter');
  let e = await estado(g);
  if (!e.aberto) falhar(w, 'Enter no "Ações" não abriu o menu');
  else {
    if (e.focoItem < 0) await pagina.keyboard.press('ArrowDown');
    e = await estado(g);
    const itens = e.filhos.map((f, i) => ({ ...f, i })).filter((f) => f.papel === 'menuitem');
    const habilitados = itens.filter((f) => !f.desabilitado);
    if (e.focoItem < 0) falhar(w, 'aberto pelo Enter, ↓ não levou o foco a um item do menu');
    else if (habilitados.length) {
      if (e.focoItem !== habilitados[0].i) falhar(w, `foco no item ${e.focoItem}, esperado o 1º habilitado (${habilitados[0].i})`);
      await pagina.keyboard.press('End');
      e = await estado(g);
      if (e.focoItem !== habilitados.at(-1).i) falhar(w, `End levou o foco a ${e.focoItem}, esperado ${habilitados.at(-1).i}`);
      await pagina.keyboard.press('ArrowDown');
      e = await estado(g);
      if (e.focoItem !== habilitados[0].i) falhar(w, `↓ no último não voltou ao 1º (foco ${e.focoItem})`);
      await pagina.keyboard.press('ArrowUp');
      e = await estado(g);
      if (e.focoItem !== habilitados.at(-1).i) falhar(w, `↑ no 1º não foi ao último (foco ${e.focoItem})`);
      await pagina.keyboard.press('Home');
      e = await estado(g);
      if (e.focoItem !== habilitados[0].i) falhar(w, `Home levou o foco a ${e.focoItem}`);
      if (itens.some((f) => f.desabilitado && f.i === e.focoItem)) falhar(w, 'foco parou em item desabilitado');
    }
  }
  // Esc fecha e devolve o foco ao gatilho (com o foco onde estiver: item ou gatilho).
  await pagina.keyboard.press('Escape');
  if (!(await fechado(g))) falhar(w, 'Esc não fechou o menu');
  else if (!(await g.evaluate((el) => document.activeElement === el))) falhar(w, 'Esc fechou, mas o foco não voltou ao "Ações"');
  if (!(await fechado(g))) await g.click();

  // Espaço abre.
  await g.focus();
  await pagina.keyboard.press(' ');
  if (await fechado(g)) falhar(w, 'Espaço no "Ações" não abriu o menu');
  await pagina.keyboard.press('Escape');
  if (!(await fechado(g))) {
    falhar(w, 'Esc (aberto pelo Espaço, foco no gatilho) não fechou o menu');
    await g.click();
  }

  // Clique: forma do menu (A-2, A-3), print (A-4) e clique fora.
  await g.click();
  e = await estado(g);
  if (!e.aberto) falhar(w, 'o clique no "Ações" não abriu o menu');
  else {
    const c = e.caixa;
    if (c.top < 0 || c.left < 0 || c.bottom > e.janela.h + 0.5 || c.right > e.janela.w + 0.5)
      falhar(w, `menu fora da janela: ${JSON.stringify({ top: Math.round(c.top), left: Math.round(c.left), bottom: Math.round(c.bottom), right: Math.round(c.right) })} em ${e.janela.w}×${e.janela.h}`);
    // Inteiro à vista: o ponto central de cada item é o próprio item (nada do quadro por cima).
    const cobertos = await pagina.evaluate((id) => {
      const m = document.getElementById(id);
      return [...(m?.querySelectorAll('[role="menuitem"]') ?? [])]
        .filter((it) => {
          const r = it.getBoundingClientRect();
          const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !topo || !(topo === it || it.contains(topo));
        })
        .map((it) => it.textContent?.trim());
    }, await g.getAttribute('aria-controls'));
    if (cobertos.length) falhar(w, `itens cobertos ou cortados pelo quadro: ${cobertos.join(', ')}`);
    const itens = e.filhos.filter((f) => f.papel === 'menuitem');
    for (const f of itens) {
      if (f.cortado || /…$|\.\.\.$/.test(f.texto)) falhar(w, `rótulo cortado: "${f.texto}"`);
      if (VERBO_PERIGO.test(f.texto) && !f.perigo) falhar(w, `"${f.texto}" é perigo e não está marcado como perigo`);
      if (f.perigo && f.cor !== COR_PERIGO) falhar(w, `perigo "${f.texto}" na cor ${f.cor} (esperado ${COR_PERIGO})`);
      if (larg === '390' && f.caixa.height < 44) falhar(w, `item "${f.texto}" com ${Math.round(f.caixa.height)} px de altura (< 44)`);
    }
    const primeiroPerigo = e.filhos.findIndex((f) => f.perigo);
    if (primeiroPerigo >= 0) {
      if (e.filhos.slice(primeiroPerigo).some((f) => f.papel === 'menuitem' && !f.perigo)) falhar(w, 'item comum depois de um perigo');
      if (itens.some((f) => !f.perigo) && e.filhos[primeiroPerigo - 1]?.papel !== 'separator') falhar(w, 'perigo sem o traço separador antes');
    }
    if (larg === '390') {
      const gc = e.gatilho.caixa;
      if (gc.height < 44 || gc.width < 44) falhar(w, `"Ações" com ${Math.round(gc.width)}×${Math.round(gc.height)} px (< 44)`);
      const principal = await g.evaluate((el) => {
        const irmao = el.parentElement?.querySelector('button:not(.mx-acoes-gatilho):not([role="menuitem"])');
        if (!irmao) return null;
        const r = irmao.getBoundingClientRect();
        return { texto: irmao.textContent?.trim(), w: r.width, h: r.height };
      });
      if (principal && (principal.h < 44 || principal.w < 44)) falhar(w, `ação principal "${principal.texto}" com ${Math.round(principal.w)}×${Math.round(principal.h)} px (< 44)`);
    }
    if (arquivoPrint) {
      await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await pagina.screenshot({ path: join(SAIDA, arquivoPrint), fullPage: false });
      prints.push(arquivoPrint);
    }
  }
  // Clique fora num ponto neutro: o título da página (o canto da janela pode ser um link do menu lateral e navegar).
  const neutro = await pagina.evaluate(() => {
    const h = document.querySelector('main h1, h1');
    const r = h?.getBoundingClientRect();
    return r && r.width ? { x: r.left + 2, y: r.top + r.height / 2 } : { x: 2, y: window.innerHeight - 2 };
  });
  await pagina.mouse.click(Math.round(neutro.x), Math.round(neutro.y));
  if (!(await fechado(g))) {
    falhar(w, 'clique fora não fechou o menu');
    await pagina.keyboard.press('Escape');
  }

  // Rolagem fecha: rola o quadro do gatilho, se tiver rolagem, senão a página; sem nada rolável, o evento de rolagem.
  await trazerParaVista(pagina, g);
  await g.click();
  if (await fechado(g)) falhar(w, 'o clique no "Ações" não abriu o menu (antes da rolagem)');
  else {
    await g.evaluate((el) => {
      let p = el.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      if (p) p.scrollTop += p.scrollTop > 0 ? -20 : 20;
      else if (document.scrollingElement && document.scrollingElement.scrollHeight > window.innerHeight) window.scrollBy(0, window.scrollY > 0 ? -20 : 20);
      else document.dispatchEvent(new Event('scroll'));
    });
    await pagina.waitForTimeout(100);
    if (!(await fechado(g))) {
      falhar(w, 'a rolagem não fechou o menu');
      await pagina.keyboard.press('Escape');
    }
  }
  conferidas.push(w);
}

/** Linhas com fileira de botões ou "⋯" (A-6 na tela): fora o menu, cada linha tem no máximo o "Ações" e uma principal. */
async function conferirLinhas(pagina, onde) {
  const achados = await pagina.evaluate(() => {
    const r = [];
    for (const tr of document.querySelectorAll('tbody tr, [role="row"], li')) {
      const botoes = [...tr.querySelectorAll('button, a.mx-botao, a.mx-botao-secundario')].filter((b) => !b.closest('[role="menu"]') && b.getClientRects().length);
      const rotulos = botoes.map((b) => (b.textContent ?? '').trim());
      if (rotulos.some((t) => /^(⋯|…|\.\.\.)$/.test(t))) r.push(`botão "⋯" na linha "${tr.textContent?.trim().slice(0, 40)}"`);
      const soltos = botoes.filter((b) => !b.classList.contains('mx-acoes-gatilho'));
      if (soltos.length > 1) r.push(`fileira de ${soltos.length} botões na linha "${tr.textContent?.trim().slice(0, 40)}": ${rotulos.join(' | ')}`);
    }
    return [...new Set(r)];
  });
  for (const a of achados) falhar(onde, a);
}

const navegador = await chromium.launch();
try {
  if (BANCADA) {
    const UI = resolve(argumento('ui', RAIZ));
    const pasta = join(SAIDA, 'bancada');
    mkdirSync(pasta, { recursive: true });
    const esbuild = require(resolverPnpm('esbuild'));
    const fonte = readFileSync(join(RAIZ, 'tests/e2e/menu-acoes-bancada.tsx'), 'utf8').replace('../../packages/ui/src/MenuAcoes', join(UI, 'packages/ui/src/MenuAcoes'));
    await esbuild.build({
      stdin: { contents: fonte, resolveDir: join(RAIZ, 'tests/e2e'), loader: 'tsx' },
      bundle: true,
      outfile: join(pasta, 'bancada.js'),
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      nodePaths: [join(RAIZ, 'node_modules/.pnpm/node_modules'), join(UI, 'packages/ui/node_modules'), join(RAIZ, 'apps/web/node_modules')],
      logLevel: 'error',
    });
    const css = ['tokens.css', 'botoes.css'].map((f) => `<link rel="stylesheet" href="${pathToFileURL(join(UI, 'packages/ui/src', f))}">`).join('');
    writeFileSync(join(pasta, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body style="margin:0"><div id="raiz"></div><script src="bancada.js"></script></body></html>`);
    for (const { nome, viewport } of LARGURAS) {
      const p = await (await navegador.newContext({ viewport, deviceScaleFactor: 1, locale: 'pt-BR' })).newPage();
      const erros = [];
      p.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
      await p.goto(pathToFileURL(join(pasta, 'index.html')).href);
      const gatilhoDa = (n) => p.getByRole('button', { name: `Ações de Cadastro fictício ${n}`, exact: true });
      await gatilhoDa(1).waitFor();
      await conferirMenu(p, gatilhoDa(1), 'bancada 1ª linha', nome, `bancada-1a-linha-${nome}.png`);
      // Última linha visível do quadro com overflow: rola o quadro até o fim e confere a última linha.
      await p.locator('[data-quadro]').evaluate((q) => (q.scrollTop = q.scrollHeight));
      await conferirMenu(p, gatilhoDa(12), 'bancada última linha do quadro', nome, `bancada-ultima-linha-${nome}.png`);
      // Item escolhido aciona a ação certa e fecha o menu, com o foco de volta no gatilho.
      const g = gatilhoDa(12);
      await trazerParaVista(p, g);
      await g.click();
      await p.getByRole('menuitem', { name: 'Editar' }).click();
      const acionadas = await p.evaluate(() => window.acionadas);
      if (acionadas.at(-1) !== 'editar-12') falhar(`bancada [${nome}]`, `"Editar" acionou ${acionadas.at(-1)}`);
      if (!(await fechado(g))) falhar(`bancada [${nome}]`, 'o menu ficou aberto depois de escolher o item');
      // Item desabilitado não aciona.
      await g.click();
      await p.getByRole('menuitem', { name: 'Tentar de novo' }).click({ force: true });
      if ((await p.evaluate(() => window.acionadas)).includes('travado-12')) falhar(`bancada [${nome}]`, 'item desabilitado acionou');
      await p.keyboard.press('Escape');
      for (const e of erros) falhar(`bancada [${nome}]`, `erro na página: ${e}`);
      await p.context().close();
    }
  } else {
    const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
    const urls = urlsDasTelas(dados).filter((u) => u.contexto !== 'sem-sessao');
    for (const { nome, viewport } of LARGURAS) {
      const opcoes = { viewport, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Manaus' };
      const sessao = async (u, chegou) => {
        const p = await (await navegador.newContext(opcoes)).newPage();
        p.setDefaultTimeout(30_000);
        await entrar(p, BASE, u);
        await p.waitForURL((x) => chegou(new URL(x).pathname));
        return p;
      };
      const paginas = { bko: await sessao(dados.administrador, (c) => !c.startsWith('/login')), portal: await sessao(dados.superadmin, (c) => c === '/config') };
      const visitar = async (p, url) => {
        await p.goto(`${BASE}${url}`, { waitUntil: 'load' });
        await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await conferirLinhas(p, `${url} [${nome}]`);
        const g = p.locator('.mx-acoes-gatilho').first();
        if (await g.count()) await conferirMenu(p, g, url, nome, `${url.replace(/^\//, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, 'id').replace(/[^a-z0-9]+/gi, '_') || 'inicio'}-${nome}.png`);
      };
      for (const item of urls) {
        const p = paginas[item.contexto];
        await visitar(p, item.url);
        if (item.abas) for (const aba of await abasDaEmpresa(p, BASE, item.url)) await visitar(p, aba);
      }
    }
  }
} catch (e) {
  falhar('roteiro', String(e?.message ?? e).split('\n').slice(0, 6).join(' / '));
} finally {
  await navegador.close();
}

console.log(JSON.stringify({ modo: BANCADA ? 'bancada' : BASE, conferidas, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
