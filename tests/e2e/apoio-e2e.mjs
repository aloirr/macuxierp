/** Apoio comum dos e2e (`bko-cadastro.mjs`, `portal-integracao.mjs`, `render-telas.mjs`, `menu-acoes.mjs`) e dos servidores que eles usam (`api-real.ts`, `apoio-api.ts`). */
import { join } from 'node:path';

/** Valor de `--<nome> <valor>` na linha de comando, ou `padrao`. */
export function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

/**
 * Login único (`/login`, RN-CORE-12; ADR 0021): abre a tela, preenche só o e-mail e a senha de `u` e clica em Entrar. Quem
 * chama espera o destino (BKO, /config ou o alerta de recusa): a API decide pelo e-mail.
 */
export async function entrar(pagina, base, u) {
  await pagina.goto(`${base}/login`);
  // o formulário é controlado pelo React: preencher antes da hidratação (next dev compilando) perde o que foi digitado
  await pagina.waitForLoadState('networkidle').catch(() => undefined);
  await pagina.getByLabel('E-mail').fill(u.email);
  // exact: o botão "Mostrar senha" também casa com "Senha".
  await pagina.getByLabel('Senha', { exact: true }).fill(u.senha);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
}

/** O HTML é a página "não encontrada" do app (404, ou 200 quando o streaming do Next já começou). */
export const ehNaoEncontrada = (html) => html.includes('>Página não encontrada<');

export function exigir(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Registro dos passos e prints de um e2e; `mascarar` limpa a mensagem de erro (ex.: tira a chave). */
export function criarRoteiro(saida, mascarar = (s) => s) {
  const resultados = [];
  const prints = [];
  async function passo(nome, fn) {
    const ini = Date.now();
    try {
      await fn();
      resultados.push({ nome, ok: true });
    } catch (e) {
      resultados.push({ nome, ok: false, erro: mascarar(String(e?.message ?? e).split('\n')[0]) });
    }
    console.error(`[e2e] ${resultados.at(-1).ok ? 'ok   ' : 'FALHA'} ${nome} (${Date.now() - ini} ms)`);
  }
  async function print(pagina, arquivo, recorte) {
    // O selo "N" do next dev não é do produto: some do print para a revisão de marca.
    await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    // Só o viewport (sem fullPage); tela densa vai recortada: cada PNG fica abaixo de 250 KB (RD-0068).
    await pagina.screenshot({ path: join(saida, arquivo), fullPage: false, ...(recorte ? { clip: recorte } : {}) });
    prints.push(arquivo);
  }
  return { resultados, prints, passo, print };
}

/** Contexto de cada URL: sem sessão (telas de entrada), BKO (administrador do tenant) ou portal /config (superadmin). */
const SEM_SESSAO = new Set(['/login', '/config/entrar']);
const contextoDe = (url) => (SEM_SESSAO.has(url) ? 'sem-sessao' : url.startsWith('/config') ? 'portal' : 'bko');

/**
 * Lista das telas do web, sem lista à mão (X-6 e T-0099): todo `page.tsx` de apps/web/src/app vira uma URL; o
 * `[modulo]/[...pagina]` do shell abre cada rota de `PAGINAS_REGISTRADAS`; `/config/empresas/[id]` abre a empresa de teste
 * (as abas saem de `abasDaEmpresa`). Segmento dinâmico novo, sem valor aqui, derruba o e2e. `dados` é o JSON do
 * `api-render-telas.ts`.
 */
export function urlsDasTelas(dados) {
  const urls = [];
  for (const dir of dados.paginasDoApp) {
    const segs = dir.split('/').filter((s) => s && !/^\(.*\)$/.test(s));
    const molde = `/${segs.join('/')}`;
    if (molde === '/[modulo]/[...pagina]') {
      for (const t of dados.telas) urls.push({ url: t.url, origem: `PAGINAS_REGISTRADAS ${t.rota}`, comParametro: t.comParametro });
    } else if (molde === '/config/empresas/[id]') {
      urls.push({ url: `/config/empresas/${dados.empresa.id}`, origem: 'page.tsx /config/empresas/[id]', abas: true });
    } else if (segs.some((s) => s.startsWith('['))) {
      throw new Error(`page.tsx com segmento dinâmico sem valor no e2e: ${molde} (ensine o tests/e2e/apoio-e2e.mjs a abrir esta tela)`);
    } else urls.push({ url: molde, origem: `page.tsx ${molde}` });
  }
  return urls.map((u) => ({ ...u, contexto: contextoDe(u.url) }));
}

/** Caminhos (sem repetição e sem a própria `url`) das abas que a tela da empresa aberta em `pagina` lista. */
export async function abasDaEmpresa(pagina, base, url) {
  const hrefs = await pagina
    .getByRole('navigation', { name: 'Abas da empresa' })
    .getByRole('link')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')).filter(Boolean))
    .catch(() => []);
  const caminhos = hrefs.map((h) => {
    const u = new URL(h, `${base}${url}`);
    return `${u.pathname}${u.search}`;
  });
  return [...new Set(caminhos)].filter((h) => h !== url);
}

/** Larguras dos prints de versão (1280 e 390), usadas pelos roteiros `prints-v*.mjs` (RD-2196). */
export const LARGURAS_PRINT = [
  { nome: '1280', viewport: { width: 1280, height: 800 } },
  { nome: '390', viewport: { width: 390, height: 844 } },
];

/** Texto técnico ou de falha que nunca pode aparecer numa tela com a API real (RD-2196: a união das listas do v0312 e do v0315). */
const PROIBIDOS_PRINT = [
  /\b404\b/,
  /Rota não encontrada/i,
  /NAO_ENCONTRADO/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
  /Internal Server Error/i,
  /Algo deu errado/i,
  /Não foi possível/i,
  /indisponível agora/i,
];

/** Confere a tela contra defeito visível: texto proibido e rolagem horizontal. */
export async function semDefeitoVisivel(pagina, onde) {
  const texto = await pagina.locator('body').innerText();
  for (const r of PROIBIDOS_PRINT) exigir(!r.test(texto), `${onde}: texto proibido ${r} na tela`);
  const rola = await pagina.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  exigir(!rola, `${onde}: rolagem horizontal`);
}
