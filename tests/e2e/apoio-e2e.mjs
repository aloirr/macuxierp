/** Apoio comum dos e2e (`bko-cadastro.mjs`, `portal-integracao.mjs`, `render-telas.mjs`, `menu-acoes.mjs`) e dos servidores que eles usam (`api-real.ts`, `apoio-api.ts`). */
import { join } from 'node:path';

/**
 * T-0135: o navegador de todo e2e sai em pt-BR e no fuso de Manaus. Sem isso a data que a tela formata no navegador vem
 * em mm/dd/yyyy (o Chromium headless cai no en-US). Receita do quadro (28/11): o Chromium completo com `--lang=pt-BR` e
 * LANGUAGE/LANG, mais `locale` e `timezoneId` em todo contexto (`novoContexto`, que sobrepõe o que o roteiro passar).
 */
export const CONTEXTO_PT_BR = Object.freeze({ locale: 'pt-BR', timezoneId: 'America/Manaus' });

/** Abre o Chromium em pt-BR (receita do quadro). `chromium` é o do `playwright` que o roteiro já carregou. */
export function abrirNavegador(chromium) {
  return chromium.launch({ channel: 'chromium', args: ['--lang=pt-BR'], env: { ...process.env, LANGUAGE: 'pt_BR', LANG: 'pt_BR.UTF-8' } });
}

/**
 * Contexto novo com `CONTEXTO_PT_BR` por cima de `opcoes` e conferido antes de devolver: 28/11/2026 15:00 UTC tem de sair
 * "28/11/2026" e "11:00" no navegador. Se sair outra coisa, o e2e para aqui, antes de conferir data em tela.
 */
export async function novoContexto(navegador, opcoes = {}) {
  const contexto = await navegador.newContext({ ...opcoes, ...CONTEXTO_PT_BR });
  const p = await contexto.newPage();
  const data = await p.evaluate(() => new Date(Date.UTC(2026, 10, 28, 15, 0)).toLocaleString()); // hora-fixa-ok: data de teste do formato pt-BR, não é relógio
  await p.close();
  exigir(data.includes('28/11/2026') && data.includes('11:00'), `navegador fora do pt-BR/Manaus: a data de teste saiu "${data}"`);
  return contexto;
}

/**
 * Asserções novas da T-0135, prontas e desligadas até o PR do dono entrar no main (nenhum teste é pulado: desligada, a
 * asserção roda e só avisa "pendente"; ligada, reprova). Para ligar: troque `false` por `true` aqui, no PR do testes
 * depois do merge do dono; para ensaiar o PR do dono antes, `MX_LIGAR=carregadoSoComData,singularRegistroCarregado`.
 *  - carregadoSoComData: na aba Integrações do /config, o selo "Carregado" só com a data da última carga (sem "—") e o
 *    "Cadastro manual" sem data de carga.
 *  - singularRegistroCarregado: o anúncio da TabelaDensa com 1 linha diz "1 registro carregado." (designer-ux).
 */
// carregadoSoComData ligada: a decisão B entrou no main pelo #952 (a55ca9a). singularRegistroCarregado ligada: #958 (f8eb502).
const LIGADAS = { carregadoSoComData: true, singularRegistroCarregado: true };
const LIGADAS_POR_ENV = new Set((process.env.MX_LIGAR ?? '').split(',').map((s) => s.trim()).filter(Boolean));
export const assercaoLigada = (nome) => {
  if (!(nome in LIGADAS)) throw new Error(`asserção desconhecida: ${nome}`);
  return LIGADAS[nome] || LIGADAS_POR_ENV.has(nome);
};

/**
 * T-0135 (`carregadoSoComData`, decisão B, #952): na aba Integrações aberta em `pagina`, toda linha com o selo "Carregado" (a
 * célula da Situação só com o `Chip`, que não tem classe) mostra a data da última carga (dd/mm/aaaa), nunca "—"; e toda linha
 * "Cadastro manual" (registro ativo sem carga) não tem data de carga. Lê só o visível (`innerText`): no 390 a coluna some e a
 * data sobe para sob o nome (#840). Devolve quantas linhas de cada selo leu e a mensagem do defeito ('' se conforme); quem
 * chama decide com `exigirQuandoLigada`.
 */
export async function carregadoSemData(pagina, onde) {
  const linhasDo = (selo) =>
    pagina.locator('tbody tr').evaluateAll(
      (trs, s) => trs.filter((tr) => [...tr.querySelectorAll('td')].some((td) => td.textContent?.trim() === s)).map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
      selo,
    );
  const comData = (t) => /\b\d{2}\/\d{2}\/\d{4}\b/.test(t);
  const linhas = await linhasDo('Carregado');
  const manuais = await linhasDo('Cadastro manual');
  const semData = linhas.filter((t) => !comData(t));
  const manualComData = manuais.filter(comData);
  const curto = (l) => l.map((t) => t.slice(0, 60)).join(' | ');
  const defeitos = [
    semData.length > 0 ? `${onde}: ${semData.length} de ${linhas.length} linha(s) "Carregado" sem data: ${curto(semData)}` : '',
    manualComData.length > 0 ? `${onde}: ${manualComData.length} linha(s) "Cadastro manual" com data de carga: ${curto(manualComData)}` : '',
  ].filter(Boolean);
  return { lidas: linhas.length, manuais: manuais.length, defeito: defeitos.join('; ') };
}

/** Confere `cond`: ligada, falha como `exigir`; desligada, só avisa no stderr e devolve se passou. */
export function exigirQuandoLigada(nome, cond, msg) {
  if (assercaoLigada(nome)) exigir(cond, msg);
  else if (!cond) console.error(`[e2e] pendente (${nome}, T-0135; desligada até o PR do dono): ${msg}`);
  return Boolean(cond);
}

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
  // T-0135: data que só existe em mm/dd/yyyy (o segundo número passa de 12) e hora com AM/PM, sinal de navegador fora do pt-BR
  /\b\d{1,2}\/(1[3-9]|2\d|3[01])\/\d{4}\b/,
  /\b\d{1,2}:\d{2}(:\d{2})? ?[AP]M\b/,
];

/** Confere a tela contra defeito visível: texto proibido e rolagem horizontal. */
export async function semDefeitoVisivel(pagina, onde) {
  const texto = await pagina.locator('body').innerText();
  for (const r of PROIBIDOS_PRINT) exigir(!r.test(texto), `${onde}: texto proibido ${r} na tela`);
  const rola = await pagina.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  exigir(!rola, `${onde}: rolagem horizontal`);
}
