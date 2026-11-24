#!/usr/bin/env node
/**
 * T-0056 (E3): e2e da Integração FDV com as TELAS REAIS (portal /config do superadmin e BKO do tenant, next dev) e a API
 * REAL (`tests/e2e/api-portal-integracao.ts`: plugins de produção, Postgres local, RLS). Só dados fictícios. Molde:
 * `tests/e2e/bko-cadastro.mjs` (Playwright global por require('playwright'), Chromium já instalado, sem trace).
 * Sem Hub: nenhum worker de pé e o "Testar conexão" não é clicado (nada sai para o FDV).
 *
 * Uso: `bash tests/e2e/rodar-portal-integracao.sh [pasta dos prints]` (sobe a API e o next dev), ou à mão:
 *   node tests/e2e/portal-integracao.mjs --base http://localhost:3101 --dados <json da API> --saida <pasta dos prints>
 * Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argumento, criarRoteiro, exigir } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3101');
const SAIDA = argumento('saida', null);
const DADOS = argumento('dados', null);
if (!SAIDA || !DADOS) {
  console.error('uso: node tests/e2e/portal-integracao.mjs --base <url do web> --dados <json do api-portal-integracao.ts> --saida <pasta dos prints>');
  process.exit(2);
}
mkdirSync(SAIDA, { recursive: true });

const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
const API = dados.url;
// Segredos gerados a cada execução (nunca impressos): a senha nova do superadmin e a chave fictícia do conector.
const SENHA_NOVA = `Nova-${randomBytes(12).toString('base64url')}-9`;
const CHAVE = `mxc_${randomBytes(32).toString('base64url')}`;
const CONECTOR = 'erp-e2e-t0056';
const ROTULO = 'Produtos';
const ENTIDADE = 'produto';

// A mensagem de erro nunca leva a chave: se vier nela, sai mascarada.
const { resultados, prints, passo, print } = criarRoteiro(SAIDA, (s) => s.replaceAll(CHAVE, '<chave>'));

// ---- API direta (conferência do estado; os mesmos caminhos que o BFF usa) ----
async function apiPortal() {
  const r = await fetch(`${API}${dados.portal.prefixo}/auth/entrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [dados.portal.csrf]: '1' },
    body: JSON.stringify({ email: dados.superadmin.email, senha: SENHA_NOVA }),
  });
  exigir(r.status === 200, `login do portal na API: ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${dados.portal.cookie}=`));
  exigir(cookie, 'login do portal sem cookie');
  const l = await fetch(`${API}${dados.portal.ler}`, { headers: { cookie } });
  const corpo = await l.text();
  exigir(l.status === 200, `GET integração do portal: ${l.status}`);
  return JSON.parse(corpo);
}
async function apiStatusTenant() {
  const a = dados.administrador;
  const r = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresa: a.empresa, email: a.email, senha: a.senha }) });
  exigir(r.status === 200, `login do BKO na API: ${r.status}`);
  const { token_acesso } = await r.json();
  const s = await fetch(`${API}/v1/integracao-fdv/status`, { headers: { authorization: `Bearer ${token_acesso}` } });
  const corpo = await s.text();
  exigir(s.status === 200, `GET status do tenant: ${s.status}`);
  return JSON.parse(corpo);
}
const ligadaNa = (status) => status.cadastros.find((c) => c.entidade === ENTIDADE)?.ligada;

const navegador = await chromium.launch();
const opcoes = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' };
const portal = await (await navegador.newContext(opcoes)).newPage();
const bko = await (await navegador.newContext(opcoes)).newPage();
// O next dev compila cada página no primeiro acesso: prazo maior que o padrão.
portal.setDefaultTimeout(90_000);
bko.setDefaultTimeout(90_000);

const linha = (p, rotulo) => p.getByRole('row').filter({ hasText: new RegExp(`^\\s*${rotulo}`) });
const seloDe = async (p, rotulo) => ((await linha(p, rotulo).locator('.selo').first().textContent()) ?? '').trim();
const htmlSemChave = async (p, onde) => exigir(!(await p.content()).includes(CHAVE), `a chave aparece no HTML de ${onde}`);

async function ligarOuDesligar(acao) {
  await portal.getByRole('button', { name: `${acao}: ${ROTULO}` }).click();
  const dialogo = portal.getByRole('dialog');
  await dialogo.getByRole('heading', { name: `${acao} ${ROTULO}?` }).waitFor();
  await dialogo.getByRole('button', { name: acao, exact: true }).click();
  await portal.getByRole('status').filter({ hasText: acao === 'Ligar' ? 'Cadastro ligado.' : 'Cadastro desligado.' }).waitFor();
  const esperado = acao === 'Ligar' ? 'Ligada' : 'Desligada';
  await portal.waitForFunction(
    ([r, e]) => [...document.querySelectorAll('tr')].some((tr) => tr.textContent?.trim().startsWith(r) && tr.querySelector('.selo')?.textContent?.trim() === e),
    [ROTULO, esperado],
  );
}

/** Situação por cadastro como a tela mostra: [rótulo da 1ª célula, texto do selo], na ordem das linhas. */
const selos = (p) =>
  p.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('td,th')?.textContent?.trim() ?? '', tr.querySelector('.selo')?.textContent?.trim() ?? '']));
const textoSelos = (l) => l.map(([r, s]) => `${r}=${s}`).join(', ');

/** O BKO (recarregado) mostra, cadastro a cadastro, o mesmo que o portal e o `GET /v1/integracao-fdv/status`; Produtos = `esperado`. */
async function bkoConfere(esperado) {
  await bko.reload();
  await bko.getByTestId('sinal').waitFor();
  const sinal = (await bko.getByTestId('sinal').textContent()) ?? '';
  exigir(sinal.includes('ainda sem sinal do conector'), `sinal do BKO: ${sinal}`);
  const selo = await seloDe(bko, ROTULO);
  exigir(selo === esperado, `BKO mostra ${ROTULO} "${selo}", esperado "${esperado}"`);
  const noBko = await selos(bko);
  const noPortal = await selos(portal);
  exigir(noBko.length === 10 && textoSelos(noBko) === textoSelos(noPortal), `BKO × portal: ${textoSelos(noBko)} || ${textoSelos(noPortal)}`);
  await htmlSemChave(bko, 'BKO');
  exigir((await bko.locator('main form, main input').count()) === 0, 'a tela do BKO tem formulário ou campo');
  exigir((await bko.locator('main').getByRole('button', { name: /Ligar|Desligar|credencial|Testar|Carga/ }).count()) === 0, 'a tela do BKO tem botão de escrita');
  const api = await apiStatusTenant();
  const naApi = api.cadastros.map((c) => (c.ligada ? 'Ligada' : 'Desligada')).join(',');
  exigir(naApi === noBko.map(([, s]) => s).join(','), `API do tenant × BKO: ${naApi} || ${textoSelos(noBko)}`);
}

try {
  await passo('(a) superadmin entra em /config/entrar com a senha provisória e a tela manda trocar; troca e chega à lista', async () => {
    await portal.goto(`${BASE}/config/entrar`);
    await portal.getByRole('heading', { level: 1, name: 'Plataforma Macuxi ERP' }).waitFor();
    await portal.getByLabel('E-mail').fill(dados.superadmin.email);
    await portal.getByLabel('Senha').fill(dados.superadmin.senhaProvisoria);
    await portal.getByRole('button', { name: 'Entrar' }).click();
    await portal.getByRole('heading', { level: 1, name: 'Defina uma senha nova' }).waitFor();
    await portal.getByLabel('Senha provisória atual').fill(dados.superadmin.senhaProvisoria);
    await portal.getByLabel('Senha nova', { exact: true }).fill(SENHA_NOVA);
    await portal.getByLabel('Confirme a senha nova').fill(SENHA_NOVA);
    await portal.getByRole('button', { name: 'Definir senha' }).click();
    await portal.waitForURL((u) => new URL(u).pathname === '/config');
    await portal.getByRole('row').filter({ hasText: dados.empresa.nome }).first().waitFor();
  });

  await passo('(b) abre a empresa pela lista e a aba Integração: sem credencial, Ligar e Testar desabilitados', async () => {
    await portal.getByRole('row').filter({ hasText: dados.empresa.nome }).getByRole('link').click();
    await portal.getByRole('heading', { level: 1, name: dados.empresa.nome }).waitFor();
    await portal.getByRole('navigation', { name: 'Abas da empresa' }).getByRole('link', { name: 'Integração' }).click();
    await portal.waitForURL((u) => new URL(u).searchParams.get('aba') === 'integracao');
    await portal.getByRole('heading', { name: 'Credencial do conector' }).waitFor();
    exigir(await portal.getByText('Nenhuma credencial cadastrada.').isVisible(), 'faltou o aviso de sem credencial');
    exigir(await portal.getByRole('button', { name: `Ligar: ${ROTULO}` }).isDisabled(), 'Ligar habilitado sem credencial');
    exigir(await portal.getByRole('button', { name: 'Testar conexão' }).isDisabled(), 'Testar conexão habilitado sem credencial');
    exigir((await seloDe(portal, ROTULO)) === 'Desligada', 'Produtos não começou desligado');
    await print(portal, '01-portal-integracao-sem-credencial.png');
  });

  await passo('(c) grava a credencial fictícia: "Credencial salva.", campo da chave vazio, só o prefixo na tela e na API; nenhum cadastro ligado', async () => {
    const form = portal.getByRole('form', { name: 'Credencial do conector' });
    await form.getByLabel('Código do conector').fill(CONECTOR);
    await form.getByLabel('Nova chave do conector').fill(CHAVE);
    await form.getByLabel('Ambiente').selectOption('teste');
    await form.getByRole('button', { name: 'Salvar credencial' }).click();
    await portal.getByRole('status').filter({ hasText: 'Credencial salva.' }).waitFor();
    await form.getByRole('button', { name: 'Trocar credencial' }).waitFor();
    exigir((await form.getByLabel('Nova chave do conector').inputValue()) === '', 'a chave ficou no campo depois de salvar');
    const api = await apiPortal();
    exigir(api.credencial_id && api.conector_id === CONECTOR && api.ambiente === 'teste', `API do portal: ${JSON.stringify({ c: api.conector_id, a: api.ambiente })}`);
    const ficha = (await portal.locator('dl.ficha').textContent()) ?? '';
    exigir(ficha.includes(`${api.chave_prefixo}…`), `a ficha não mostra o prefixo: ${ficha.replaceAll(CHAVE, '<chave>')}`);
    await portal.reload();
    await portal.getByRole('heading', { name: 'Credencial do conector' }).waitFor();
    exigir((await portal.getByLabel('Nova chave do conector').inputValue()) === '', 'a chave voltou ao campo depois de recarregar');
    await htmlSemChave(portal, '/config depois de salvar e recarregar');
    // "Ligar um por um" (R-20261123-150400, 0042): a primeira credencial nasce sem cadastro ligado e sem carga inicial;
    // os 10 da tela "Desligada", com Ligar habilitado. A carga inicial sai ao ligar (evento no banco; a tela e a API não a mostram).
    const tela = await selos(portal);
    exigir(tela.length === 10 && tela.every(([, s]) => s === 'Desligada'), `selos depois da credencial: ${textoSelos(tela)}`);
    exigir(api.entidades_habilitadas.length === 0, `habilitadas depois da credencial: ${api.entidades_habilitadas.join(',')}`);
    exigir(api.cadastros.every((c) => !c.ligada), 'API do portal: algum cadastro ligado depois da credencial');
    exigir(await portal.getByRole('button', { name: `Ligar: ${ROTULO}` }).isEnabled(), 'Ligar desabilitado com credencial');
    await print(portal, '02-portal-credencial-salva.png');
  });

  await passo('(d1) liga Produtos com confirmação: tela "Ligada" e API só com o produto habilitado e ligado', async () => {
    await ligarOuDesligar('Ligar');
    const api = await apiPortal();
    exigir(api.entidades_habilitadas.join(',') === ENTIDADE, `habilitadas: ${api.entidades_habilitadas.join(',')}`);
    exigir(ligadaNa(api) === true, `API do portal: ${ENTIDADE} ligada=${ligadaNa(api)}`);
    exigir(api.cadastros.filter((c) => c.ligada).length === 1, `ligados na API: ${api.cadastros.filter((c) => c.ligada).length}`);
    await portal.reload();
    exigir((await seloDe(portal, ROTULO)) === 'Ligada', 'depois de recarregar, Produtos não está Ligada');
    await htmlSemChave(portal, '/config depois de ligar');
    await print(portal, '03-portal-produtos-ligado.png');
  });

  await passo('(e1) administrador entra no BKO; Integração FDV mostra Produtos Ligada, igual ao portal e à API, sem chave nem escrita', async () => {
    await bko.goto(`${BASE}/login`);
    await bko.getByLabel('Empresa').fill(dados.administrador.empresa);
    await bko.getByLabel('E-mail').fill(dados.administrador.email);
    await bko.getByLabel('Senha').fill(dados.administrador.senha);
    await bko.getByRole('button', { name: 'Entrar' }).click();
    await bko.waitForURL((u) => new URL(u).pathname === '/');
    await bko.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Integração FDV' }).click();
    await bko.getByRole('heading', { level: 1, name: 'Integração FDV' }).waitFor();
    await bkoConfere('Ligada');
    await print(bko, '04-bko-produtos-ligado.png');
  });

  await passo('(d2) desliga Produtos com confirmação: tela "Desligada" e API sem cadastro habilitado', async () => {
    await ligarOuDesligar('Desligar');
    const api = await apiPortal();
    exigir(!api.entidades_habilitadas.includes(ENTIDADE), `habilitadas: ${api.entidades_habilitadas.join(',')}`);
    exigir(ligadaNa(api) === false, `API do portal: ${ENTIDADE} ligada=${ligadaNa(api)}`);
    exigir(api.cadastros.every((c) => !c.ligada), `ligados na API: ${api.cadastros.filter((c) => c.ligada).length}`);
    await htmlSemChave(portal, '/config depois de desligar');
    await print(portal, '05-portal-produtos-desligado.png');
  });

  await passo('(e2) BKO recarregado mostra Produtos Desligada, igual ao portal e à API', async () => {
    await bkoConfere('Desligada');
    await print(bko, '06-bko-produtos-desligado.png');
  });
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, passos: resultados.length, ok: resultados.length - falhas.length, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
