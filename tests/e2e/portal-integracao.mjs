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
import { abrirNavegador, argumento, criarRoteiro, entrar, exigir, novoContexto } from './apoio-e2e.mjs';

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

const navegador = await abrirNavegador(chromium);
const opcoes = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const portal = await (await novoContexto(navegador, opcoes)).newPage();
const bko = await (await novoContexto(navegador, opcoes)).newPage();
// O next dev compila cada página no primeiro acesso: prazo maior que o padrão.
portal.setDefaultTimeout(90_000);
bko.setDefaultTimeout(90_000);

const linha = (p, rotulo) => p.getByRole('row').filter({ hasText: new RegExp(`^\\s*${rotulo}`) });
const seloDe = async (p, rotulo) => ((await linha(p, rotulo).locator('.selo').first().textContent()) ?? '').trim();
const htmlSemChave = async (p, onde) => exigir(!(await p.content()).includes(CHAVE), `a chave aparece no HTML de ${onde}`);

// Config v4 (#922, v0.3.30): a empresa tem só as abas "Empresa" e "Integrações". Em Integrações ficam as duas ligações; a do
// FDV é "ERP → Macuxi FDV" (#952; a seta é só visual: o leitor ouve "ERP para o Macuxi FDV"), com o formulário ou a ficha
// "Chave do Macuxi FDV" e, no mesmo cartão (`CartaoLigacao` da saída, envio-fdv.tsx), a tabela "Cadastros enviados" com
// Ligar/Desligar no "Ações ▾" de cada linha. A tabela dos recebidos fica no cartão da entrada, de fora.
const TITULO_SAIDA = /^ERP\s+para o\s+Macuxi FDV$/;
const formChave = portal.getByRole('form', { name: 'Chave do Macuxi FDV' });
const fichaChave = portal.locator('dl.ficha[aria-label="Chave do Macuxi FDV"]');
/** O cartão "ERP → Macuxi FDV" da aba Integrações: a chave e a tabela "Cadastros enviados" (a de recebidos fica de fora). */
const SEL_ENVIADOS = 'section[aria-labelledby="h-ligacao-saida"]';
const enviados = portal.locator(SEL_ENVIADOS);
/** O cartão "Sistema do cliente → ERP" da aba Integrações: a tabela dos cadastros recebidos (Modelo e Importar). */
const recebidos = portal.locator('section[aria-labelledby="h-ligacao-entrada"]');
// T-0137 (RD-2422): o reenvio de tudo saiu da tabela dos recebidos ("Carga completa") para o "Ações" dos enviados.
const REENVIAR = 'Reenviar tudo ao FDV';
const ABAS = portal.getByRole('navigation', { name: 'Abas da empresa' });
/**
 * Abre a aba da empresa pelo link e espera o `?aba=` dela. Se a aba já é a atual (`aria-current="page"`), não clica de novo
 * (o clique recarregaria a página no meio do passo); confere só que é ela.
 */
async function abrirAba(nome, aba) {
  const link = ABAS.getByRole('link', { name: nome, exact: true });
  if ((await link.getAttribute('aria-current')) !== 'page') await link.click();
  await portal.waitForURL((u) => new URL(u).searchParams.get('aba') === aba);
  exigir((await link.getAttribute('aria-current')) === 'page', `a aba "${nome}" não ficou marcada como atual`);
  exigir((await ABAS.getByRole('link').allInnerTexts()).join('|') === 'Empresa|Integrações', 'as abas da empresa não são "Empresa" e "Integrações"');
}

/**
 * Item `acao` do botão "Ações" da linha `rotulo` (T-0099: as ações da linha saíram dos botões soltos para o `MenuAcoes`).
 * Abre o menu e devolve o item; quem chama clica ou confere o estado (`aria-disabled`).
 */
async function itemDoMenu(rotulo, acao, onde = enviados) {
  // A tabela dos recebidos também tem "Ações de <cadastro>": o gatilho é o da tabela `onde` (por padrão, a dos enviados).
  const gatilho = onde.getByRole('button', { name: `Ações de ${rotulo}`, exact: true });
  // No next dev o primeiro clique pode chegar antes da hidratação e não abrir: tenta de novo até o menu abrir.
  for (let i = 0; i < 20 && (await gatilho.getAttribute('aria-expanded')) !== 'true'; i++) {
    await gatilho.click();
    await portal.waitForTimeout(250);
  }
  exigir((await gatilho.getAttribute('aria-expanded')) === 'true', `o menu "Ações de ${rotulo}" não abriu`);
  return menuAberto(rotulo).getByRole('menuitem', { name: acao, exact: true });
}
/** O menu "Ações de <rotulo>" aberto (só um abre por vez). */
const menuAberto = (rotulo) => portal.getByRole('menu', { name: `Ações de ${rotulo}` });
/** Linhas do registro de rotas da API (`MÉTODO rota status`), gravado pelo `api-portal-integracao.ts`. */
const rotasDaApi = () => readFileSync(dados.rotas, 'utf8').split('\n').filter(Boolean);
const itemDesabilitado = async (item) => (await item.getAttribute('aria-disabled')) === 'true';
const fecharMenu = (p) => p.keyboard.press('Escape');

async function ligarOuDesligar(acao) {
  await (await itemDoMenu(ROTULO, acao)).click();
  const dialogo = portal.getByRole('dialog');
  await dialogo.getByRole('heading', { name: `${acao} ${ROTULO}?` }).waitFor();
  await dialogo.getByRole('button', { name: acao, exact: true }).click();
  await portal.getByRole('status').filter({ hasText: acao === 'Ligar' ? 'Cadastro ligado.' : 'Cadastro desligado.' }).waitFor();
  const esperado = acao === 'Ligar' ? 'Ligado' : 'Desligado';
  await portal.waitForFunction(
    ([r, e, sel]) => [...document.querySelectorAll(`${sel} tr`)].some((tr) => tr.textContent?.trim().startsWith(r) && tr.querySelector('.selo')?.textContent?.trim() === e),
    [ROTULO, esperado, SEL_ENVIADOS],
  );
}

/** Situação por cadastro como a tela mostra: [rótulo da 1ª célula, texto do selo], na ordem das linhas com selo (a tabela de clientes recebidos fica de fora). */
const selos = (p) =>
  p.locator('tbody tr').evaluateAll((trs) =>
    trs.filter((tr) => tr.querySelector('.selo')).map((tr) => {
      // Desde o #840 o /config põe o "Último envio" (.envio-sob-nome) na 1ª célula; o BKO não tem, então o rótulo é lido sem ele.
      const celula = tr.querySelector('td,th')?.cloneNode(true);
      celula?.querySelectorAll('.envio-sob-nome').forEach((el) => el.remove());
      return [celula?.textContent?.trim() ?? '', tr.querySelector('.selo')?.textContent?.trim() ?? ''];
    }),
  );
const textoSelos = (l) => l.map(([r, s]) => `${r}=${s}`).join(', ');

/** O BKO (recarregado) mostra, cadastro a cadastro, o mesmo que o portal e o `GET /v1/integracao-fdv/status`; Produtos = `esperado`. */
async function bkoConfere(esperado) {
  await bko.reload();
  await bko.getByTestId('sinal').waitFor();
  const sinal = (await bko.getByTestId('sinal').textContent()) ?? '';
  // #920 (v0.3.30): a frase do sinal começa com maiúscula; com conector e sem envio, é exatamente esta.
  exigir(sinal.trim() === 'Ainda sem sinal do conector.', `sinal do BKO: ${sinal}`);
  const selo = await seloDe(bko, ROTULO);
  exigir(selo === esperado, `BKO mostra ${ROTULO} "${selo}", esperado "${esperado}"`);
  const noBko = await selos(bko);
  const noPortal = await selos(enviados);
  exigir(noBko.length === 10 && textoSelos(noBko) === textoSelos(noPortal), `BKO × portal: ${textoSelos(noBko)} || ${textoSelos(noPortal)}`);
  await htmlSemChave(bko, 'BKO');
  exigir((await bko.locator('main form, main input').count()) === 0, 'a tela do BKO tem formulário ou campo');
  exigir((await bko.locator('main').getByRole('button', { name: /Ligar|Desligar|chave|Testar|Carga|Reenviar/ }).count()) === 0, 'a tela do BKO tem botão de escrita');
  exigir(!(await bko.locator('main').innerText()).includes(REENVIAR), `o BKO mostra "${REENVIAR}"`);
  const api = await apiStatusTenant();
  const naApi = api.cadastros.map((c) => (c.ligada ? 'Ligado' : 'Desligado')).join(',');
  exigir(naApi === noBko.map(([, s]) => s).join(','), `API do tenant × BKO: ${naApi} || ${textoSelos(noBko)}`);
}

try {
  await passo('(a) superadmin entra no login único com a senha provisória e a tela manda trocar; troca e chega à lista', async () => {
    await entrar(portal, BASE, dados.superadmin);
    await portal.getByRole('heading', { level: 1, name: 'Defina uma senha nova' }).waitFor();
    await portal.getByLabel('Senha provisória atual').fill(dados.superadmin.senha);
    await portal.getByLabel('Senha nova', { exact: true }).fill(SENHA_NOVA);
    await portal.getByLabel('Confirme a senha nova').fill(SENHA_NOVA);
    await portal.getByRole('button', { name: 'Definir senha' }).click();
    await portal.waitForURL((u) => new URL(u).pathname === '/config');
    await portal.getByRole('row').filter({ hasText: dados.empresa.nome }).first().waitFor();
  });

  await passo('(b) abre a empresa pela lista e a aba Integrações: sem chave, o formulário da chave e sem Testar; nos Cadastros enviados, Ligar desabilitado', async () => {
    await portal.getByRole('row').filter({ hasText: dados.empresa.nome }).getByRole('link').click();
    await portal.getByRole('heading', { level: 1, name: dados.empresa.nome }).waitFor();
    await abrirAba('Integrações', 'integracao');
    await enviados.getByRole('heading', { name: TITULO_SAIDA }).waitFor();
    await formChave.waitFor();
    exigir((await enviados.locator('form[aria-label="Chave do Macuxi FDV"]').count()) === 1, 'o formulário da chave não está no cartão "ERP → Macuxi FDV"');
    exigir((await portal.getByRole('button', { name: 'Testar conexão' }).count()) === 0, 'Testar conexão aparece sem chave');
    await print(portal, '01-portal-integracao-sem-chave.png');
    // Os Cadastros enviados estão no mesmo cartão da aba Integrações (antes, na aba Dados): sem trocar de aba.
    exigir(await itemDesabilitado(await itemDoMenu(ROTULO, 'Ligar')), 'Ligar habilitado sem chave');
    await fecharMenu(portal);
    exigir((await seloDe(enviados, ROTULO)) === 'Desligado', 'Produtos não começou desligado');
  });

  await passo('(c) grava a chave fictícia: "Chave salva." e a ficha no lugar do formulário; "Trocar chave" pede confirmação; só o prefixo na tela e na API; nenhum cadastro ligado', async () => {
    await abrirAba('Integrações', 'integracao');
    await formChave.getByLabel('Código', { exact: true }).fill(CONECTOR);
    await formChave.getByLabel('Chave', { exact: true }).fill(CHAVE);
    await formChave.getByLabel('Ambiente').selectOption('teste');
    // O "Salvar chave" fica na barra do rodapé do cartão (regra 12), fora do <form>, ligado a ele pelo atributo `form`.
    const salvarChave = enviados.getByRole('button', { name: 'Salvar chave', exact: true });
    exigir((await salvarChave.getAttribute('form')) === (await formChave.getAttribute('id')), 'o "Salvar chave" não envia o formulário da chave');
    await salvarChave.click();
    await portal.getByRole('status').filter({ hasText: 'Chave salva.' }).waitFor();
    // Salva, o formulário dá lugar à ficha da ligação (a chave sai da tela) e ao "Trocar chave".
    await fichaChave.waitFor();
    exigir((await formChave.count()) === 0, 'o formulário da chave ficou depois de salvar');
    // Trocar a chave que existe pede confirmação (36 A), com Nova chave e Ambiente; grava de novo a mesma chave fictícia.
    await enviados.getByRole('button', { name: 'Trocar chave', exact: true }).click();
    const dialogo = portal.getByRole('dialog');
    await dialogo.getByRole('heading', { name: 'Trocar a chave do Macuxi FDV?' }).waitFor();
    await dialogo.getByLabel('Nova chave').fill(CHAVE);
    await dialogo.getByLabel('Ambiente').selectOption('teste');
    await dialogo.getByRole('button', { name: 'Trocar chave', exact: true }).click();
    await dialogo.waitFor({ state: 'detached' });
    const api = await apiPortal();
    exigir(api.credencial_id && api.conector_id === CONECTOR && api.ambiente === 'teste', `API do portal: ${JSON.stringify({ c: api.conector_id, a: api.ambiente })}`);
    const ficha = (await fichaChave.textContent()) ?? '';
    exigir(ficha.includes(`${api.chave_prefixo}…`), `a ficha não mostra o prefixo: ${ficha.replaceAll(CHAVE, '<chave>')}`);
    await portal.reload();
    await fichaChave.waitFor();
    exigir((await portal.locator('input[name="chave"]').count()) === 0, 'um campo de chave voltou depois de recarregar');
    await htmlSemChave(portal, '/config depois de salvar e recarregar');
    await abrirAba('Integrações', 'integracao');
    // "Ligar um por um" (R-20261123-150400, 0042): a primeira chave nasce sem cadastro ligado e sem carga inicial;
    // os 10 da tela "Desligado", com Ligar habilitado. A carga inicial sai ao ligar (evento no banco; a tela e a API não a mostram).
    const tela = await selos(enviados);
    exigir(tela.length === 10 && tela.every(([, s]) => s === 'Desligado'), `selos depois de salvar a chave: ${textoSelos(tela)}`);
    exigir(api.entidades_habilitadas.length === 0, `habilitadas depois de salvar a chave: ${api.entidades_habilitadas.join(',')}`);
    exigir(api.cadastros.every((c) => !c.ligada), 'API do portal: algum cadastro ligado depois de salvar a chave');
    exigir(!(await itemDesabilitado(await itemDoMenu(ROTULO, 'Ligar'))), 'Ligar desabilitado com chave');
    // T-0137: com o cadastro desligado, o "Reenviar tudo ao FDV" não aparece no menu.
    exigir((await menuAberto(ROTULO).getByRole('menuitem', { name: REENVIAR }).count()) === 0, `"${REENVIAR}" aparece com Produtos desligado`);
    await fecharMenu(portal);
    await print(portal, '02-portal-chave-salva.png');
  });

  await passo('(d1) liga Produtos com confirmação: tela "Ligado" e API só com o produto habilitado e ligado', async () => {
    await ligarOuDesligar('Ligar');
    const api = await apiPortal();
    exigir(api.entidades_habilitadas.join(',') === ENTIDADE, `habilitadas: ${api.entidades_habilitadas.join(',')}`);
    exigir(ligadaNa(api) === true, `API do portal: ${ENTIDADE} ligada=${ligadaNa(api)}`);
    exigir(api.cadastros.filter((c) => c.ligada).length === 1, `ligados na API: ${api.cadastros.filter((c) => c.ligada).length}`);
    await portal.reload();
    exigir((await seloDe(enviados, ROTULO)) === 'Ligado', 'depois de recarregar, Produtos não está Ligado');
    await htmlSemChave(portal, '/config depois de ligar');
    await print(portal, '03-portal-produtos-ligado.png');
  });

  await passo('(d1b) T-0137: o bloco do cliente fica sem "Carga completa" e sem Registros; "Reenviar tudo ao FDV" de Produtos (ligado) pede confirmação e chega à rota do contrato', async () => {
    // Sistema do cliente → ERP: Cadastro, Situação, Com erro e Ações à vista ("Última carga" sobe para sob o nome, por CSS).
    const visiveis = await recebidos.getByRole('columnheader').evaluateAll((ths) => ths.filter((th) => th.offsetParent !== null).map((th) => th.textContent?.trim()));
    exigir(visiveis.join('|') === 'Cadastro|Situação|Com erro|Ações', `colunas à vista do bloco do cliente: ${visiveis.join('|')}`);
    exigir((await recebidos.getByRole('columnheader', { name: 'Registros', exact: true }).count()) === 0, 'o bloco do cliente tem a coluna Registros');
    exigir(!/Carga completa|Reenviar/.test(await recebidos.innerText()), 'o bloco do cliente mostra "Carga completa" ou "Reenviar"');
    // Produtos está ligado (d1): o "Ações de Produtos" do bloco do cliente traz só Importar e Modelo (T-0099: um botão por linha).
    await itemDoMenu(ROTULO, 'Importar', recebidos);
    const doCliente = (await menuAberto(ROTULO).getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    exigir(doCliente.join('|') === 'Importar|Modelo', `menu de Produtos no bloco do cliente: ${doCliente.join('|')}`);
    await fecharMenu(portal);
    // ERP → Macuxi FDV: o "Ações de Produtos" traz o reenvio habilitado (Produtos ligado, sem lote em voo).
    const item = await itemDoMenu(ROTULO, REENVIAR);
    await item.waitFor();
    exigir(!(await itemDesabilitado(item)), `"${REENVIAR}" desabilitado com Produtos ligado`);
    const antes = rotasDaApi().length;
    await item.click();
    const dialogo = portal.getByRole('dialog');
    await dialogo.getByRole('heading', { name: 'Reenviar todos os Produtos ao FDV?', exact: true }).waitFor();
    exigir((await dialogo.innerText()).includes('Envia tudo de uma vez: pode demorar e inativar cadastros no FDV.'), 'o diálogo sem o aviso do reenvio');
    const botoes = (await dialogo.getByRole('button').allInnerTexts()).map((t) => t.trim());
    exigir(botoes.join('|') === `Cancelar|${REENVIAR}`, `botões do diálogo: ${botoes.join('|')}`);
    await print(portal, '03b-portal-reenviar-tudo-confirmacao.png');
    await dialogo.getByRole('button', { name: REENVIAR, exact: true }).click();
    await portal.getByRole('status').filter({ hasText: 'Reenvio pedido: Produtos.' }).waitFor();
    // A ação passa pelo BFF: a API registrou um POST na rota do contrato do SDK (`CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.cargaCompleta`), com sucesso.
    // O registro sai no onResponse, logo depois da resposta: espera até 5 s por ele.
    let novas = [];
    for (let i = 0; i < 20 && novas.length === 0; i++, await portal.waitForTimeout(250)) novas = rotasDaApi().slice(antes).filter((l) => l.startsWith(`POST ${dados.portal.cargaCompleta} `));
    exigir(novas.length === 1 && /\s2\d\d$/.test(novas[0]), `POST ${dados.portal.cargaCompleta} na API: ${novas.join(' ; ') || 'nenhum'}`);
    exigir((await seloDe(enviados, ROTULO)) === 'Ligado', 'Produtos deixou de estar Ligado depois do reenvio');
    await htmlSemChave(portal, '/config depois do reenvio');
    await print(portal, '03c-portal-reenvio-pedido.png');
  });

  await passo('(e1) administrador entra no BKO; Integração FDV mostra Produtos Ligado, igual ao portal e à API, sem chave nem escrita', async () => {
    await entrar(bko, BASE, dados.administrador);
    await bko.waitForURL((u) => new URL(u).pathname === '/');
    await bko.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Integração FDV' }).click();
    await bko.getByRole('heading', { level: 1, name: 'Integração FDV' }).waitFor();
    await bkoConfere('Ligado');
    await print(bko, '04-bko-produtos-ligado.png');
  });

  await passo('(d2) desliga Produtos com confirmação: tela "Desligado" e API sem cadastro habilitado', async () => {
    await ligarOuDesligar('Desligar');
    const api = await apiPortal();
    exigir(!api.entidades_habilitadas.includes(ENTIDADE), `habilitadas: ${api.entidades_habilitadas.join(',')}`);
    exigir(ligadaNa(api) === false, `API do portal: ${ENTIDADE} ligada=${ligadaNa(api)}`);
    exigir(api.cadastros.every((c) => !c.ligada), `ligados na API: ${api.cadastros.filter((c) => c.ligada).length}`);
    await htmlSemChave(portal, '/config depois de desligar');
    await print(portal, '05-portal-produtos-desligado.png');
  });

  await passo('(e2) BKO recarregado mostra Produtos Desligado, igual ao portal e à API', async () => {
    await bkoConfere('Desligado');
    await print(bko, '06-bko-produtos-desligado.png');
  });
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, passos: resultados.length, ok: resultados.length - falhas.length, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
