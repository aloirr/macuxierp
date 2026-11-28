#!/usr/bin/env node
/**
 * T-0008 (d), parte 2: e2e do BKO de cadastro com o Playwright, contra a API REAL (montarModulos de produção, adaptadores
 * SQL, Postgres local, RLS no papel macuxierp_app) com DOIS tenants (`tests/e2e/api-real.ts`).
 * Fora do vitest (não é *.test.ts) porque o @playwright/test não está no package.json: usa o Playwright instalado
 * globalmente (require('playwright'), Chromium já instalado; sem `playwright install`, sem trace).
 *
 * v0.3.28: o login fica na raiz ("/" sem sessão, #886); o menu de Cadastros tem só as telas prontas. v0.3.32 (T-0123, lote A):
 * Estoque e Tabelas oficiais (NCM, CEST, CFOP e Municípios do IBGE) entram no menu, só leitura, com a lista, a busca e os filtros
 * (UF no IBGE) provados contra a API real. Lote B: Condições de pagamento (lista, nova e edição com as parcelas "30/60/90") e Equipe e
 * carteira (lista, novo e edição de vendedor, transferência da carteira) também entram; nenhum item do cadastros fica oculto. A lista de Usuários mostra só os usuários do tenant, com o botão "Ações" em cada linha. Colunas, filtros, CSV e custo por perfil das listas
 * estão provados contra a API em tests/integracao/web/listas-bko.db.test.ts; aqui fica o que a tela mostra de cada tenant:
 * empresa, filiais, menu, usuários e licenças, e o "não encontrada" por licença e por perfil.
 *
 * Uso (pg-local.sh de pé): `bash tests/e2e/rodar-bko-cadastro.sh [pasta dos prints]` (sobe a API e o next dev), ou à mão:
 *   node tests/e2e/bko-cadastro.mjs --base http://localhost:3100 --dados <dados.json> --saida <pasta dos prints>
 * Prints em PNG do viewport, deviceScaleFactor 2. Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { abrirNavegador, argumento, criarRoteiro, ehNaoEncontrada, entrar as entrarNoLogin, exigir, novoContexto } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3100');
const SAIDA = argumento('saida', null);
const DADOS = argumento('dados', null);
if (!SAIDA || !DADOS) {
  console.error('uso: node tests/e2e/bko-cadastro.mjs --base <url do shell> --dados <json do api-real.ts> --saida <pasta dos prints>');
  process.exit(2);
}
mkdirSync(SAIDA, { recursive: true });

// Massa fictícia do api-real.ts (sem pessoa real); a senha é de um banco efêmero e não é impressa.
const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
const usuario = (empresa, perfil) => ({ ...dados.usuarios.find((u) => u.empresa === empresa && u.perfil === perfil), senha: dados.senha });
const ADM_A = usuario('loja-a', 'administrador');
const VEND_A = usuario('loja-a', 'vendedor');
const ADM_B = usuario('loja-b', 'administrador');
const EMPRESA_A = dados.empresas.A.nome;
const EMPRESA_B = dados.empresas.B.nome;
/** Ordem do manifesto do cadastros (`web.menus`), sem os ocultos. */
const MENU_CADASTROS = ['Clientes', 'Produtos', 'Tabelas de preço', 'Estoque', 'Condições de pagamento', 'Equipe e carteira', 'Filiais', 'Tabelas oficiais'];
/** Itens cujo título da página é o próprio rótulo do menu (Tabelas oficiais abre na seção NCM, passo próprio). */
const LISTAS_DO_MENU = MENU_CADASTROS.filter((r) => r !== 'Tabelas oficiais');
/** Decisão do PO (v0.3.28): sem tela pronta, fora do menu. Na T-0123 (lotes A e B) todos os itens do cadastros ganharam tela. */
const OCULTOS_CADASTROS = [];
/** Massa do api-real.ts: saldo de 1.250 UN do produto "Refrigerante 2L" na Matriz Manaus do tenant A. */
const PRODUTO_ESTOQUE = 'Refrigerante 2L';
/** Massa do api-real.ts: vendedor V01 com o cliente "Mercado Sol Ltda" na carteira (Matriz Manaus do tenant A). */
const VENDEDOR_ORIGEM = 'Vendedor Rio Negro';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** A tela de login (na raiz desde a v0.3.27) está na tela: URL "/" e o botão Entrar. */
async function exigirLogin() {
  await p.waitForURL((u) => new URL(u).pathname === '/');
  await p.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
}

const { resultados, prints, passo, print } = criarRoteiro(SAIDA);

const navegador = await abrirNavegador(chromium);
const contexto = await novoContexto(navegador, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await contexto.newPage();
// O next dev compila cada página no primeiro acesso: prazo maior que o padrão.
p.setDefaultTimeout(60_000);

const nav = () => p.getByRole('navigation', { name: 'Menu principal' });
const topo = async () => (await p.locator('header.topo').textContent()) ?? '';
const entrar = (u) => entrarNoLogin(p, BASE, u);
/**
 * RN-CORE-02: a tela sem licença ou sem permissão é "não encontrada". O 404 do HTTP é o esperado; com o streaming do Next
 * a resposta pode sair 200 com a página "não encontrada" no corpo: aceita, desde que nenhum conteúdo do módulo apareça.
 */
async function exigirNaoEncontrada(r) {
  // Com o streaming, a página "não encontrada" chega depois do "Carregando…".
  if (r?.status() === 200) await p.getByText('Página não encontrada', { exact: true }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  const corpo = (await p.locator('main').textContent().catch(() => '')) ?? '';
  const naoEncontrada = ehNaoEncontrada(await p.content());
  exigir(r?.status() === 404 || (r?.status() === 200 && naoEncontrada), `status ${r?.status()}, página: ${corpo.slice(0, 120)}`);
}
/** Linhas da tabela da lista (texto visível de cada `tr` do corpo, uma célula separada da outra por espaço). */
const linhasDaLista = async () => (await p.locator('main tbody tr').allInnerTexts()).map((l) => l.replace(/\s+/g, ' ').trim());
const textoMain = async () => (await p.locator('main').textContent()) ?? '';
const campoFiltro = (chave) => p.locator(`main form[role="search"] [name="${chave}"]`);
/**
 * Aplica um filtro da lista pela tela (texto: digita e Enter; seleção: escolhe) e espera a URL com o parâmetro e a tabela de
 * novo. `valor` vazio tira o parâmetro. A busca e os filtros são do servidor: a tabela que volta é a resposta da API real.
 */
async function filtrar(chave, valor) {
  const campo = campoFiltro(chave);
  if ((await campo.evaluate((el) => el.tagName)) === 'SELECT') await campo.selectOption(valor);
  else {
    await campo.fill(valor);
    await campo.press('Enter');
  }
  await p.waitForURL((u) => (new URL(u).searchParams.get(chave) ?? '') === valor);
  await p.waitForLoadState('networkidle').catch(() => undefined);
  await p.locator('main table').first().waitFor();
}
/** Valor da opção do seletor pelo rótulo (filial pelo nome, sem UUID escrito no teste). */
const valorDaOpcao = async (chave, rotulo) => (await campoFiltro(chave).locator('option', { hasText: rotulo }).getAttribute('value')) ?? '';
/** Abre a seção pela aba (navegação "Seções": a 1ª seção das Tabelas oficiais é o NCM, não o nome do menu) e espera o título e as linhas. */
async function abrirSecao(titulo, caminho) {
  await p.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: titulo, exact: true }).click();
  await p.waitForURL((u) => new URL(u).pathname === caminho);
  await p.getByRole('heading', { level: 1, name: titulo }).waitFor();
  await p.locator('main tbody tr').first().waitFor();
}
/** Linha da lista que contém o texto (a lista volta da API real a cada navegação). */
const linhaCom = (texto) => p.locator('main tbody tr', { hasText: texto });
/** Texto visível da linha, com as células separadas por espaço. */
const textoDaLinha = async (texto) => (await linhaCom(texto).first().innerText()).replace(/\s+/g, ' ').trim();
/** Escolhe a opção de um seletor do formulário pelo rótulo (cadastro lido da API: filial, vendedor). */
async function escolher(campo, rotulo) {
  const valor = await p.locator(`#campo-${campo} option`, { hasText: rotulo }).first().getAttribute('value');
  exigir(valor, `opção "${rotulo}" ausente em ${campo}`);
  await p.locator(`#campo-${campo}`).selectOption(valor);
}
/** Envia o formulário e espera voltar à lista (o formulário genérico volta à lista depois do 201 ou do 200). */
async function salvarEVoltar(botao, lista) {
  await p.getByRole('button', { name: botao, exact: true }).click();
  await p.waitForURL((u) => new URL(u).pathname === lista, { timeout: 30_000 }).catch(async () => {
    throw new Error(`não voltou à lista: ${(await textoMain()).slice(0, 200)}`);
  });
  await p.locator('main table').first().waitFor();
}
/** Menu lateral em acordeão (T-0138): abre o grupo (um por vez) se estiver fechado; o da tela atual já abre sozinho. */
async function abrirGrupo(nome) {
  const botao = nav().getByRole('button', { name: nome });
  if ((await botao.getAttribute('aria-expanded')) !== 'true') await botao.click();
  await nav().getByRole('region', { name: nome }).getByRole('link').first().waitFor();
}
/** "Sair" mora no menu do usuário do topo desde a T-0139. */
async function sair() {
  await p.locator('header.topo').getByRole('button', { name: /^Menu do usuário/ }).click();
  await p.getByRole('menuitem', { name: 'Sair', exact: true }).click();
  await exigirLogin();
}

try {
  await passo('sem sessão, a raiz é o login (sem redirect)', async () => {
    await p.goto(`${BASE}/`);
    await exigirLogin();
    await print(p, '01-login.png');
  });

  // Sem o código da empresa desde a ADR 0021 (T-0133): o e-mail diz a empresa; o isolamento entre A e B segue nos passos abaixo.
  await passo('login com a senha errada do tenant A: a mensagem única, o e-mail fica e a senha não volta', async () => {
    await entrar({ ...ADM_A, senha: 'senha-errada-e2e-9' });
    // O Next também tem um role=alert (anúncio de rota): o do formulário é o do ResultadoAcao, logo abaixo do Entrar.
    const alerta = p.locator('form [data-resultado-acao="erro"] [role="alert"]');
    await alerta.waitFor();
    const texto = await alerta.textContent();
    // MENSAGEM_LOGIN_INVALIDO do SDK (o .mjs roda no node sem o TypeScript do SDK)
    exigir(texto?.includes('E-mail ou senha inválidos.'), `mensagem de erro diferente: ${texto}`);
    exigir((await p.getByLabel('E-mail').inputValue()) === ADM_A.email, 'o e-mail se perdeu');
    exigir((await p.getByLabel('Senha', { exact: true }).inputValue()) === '', 'a senha voltou para a tela');
    await print(p, '02-login-erro-outro-tenant.png');
  });

  await passo('tenant A, administrador com duas filiais: a escolha mostra só as filiais de A', async () => {
    await entrar(ADM_A);
    await p.waitForURL(/\/filial/);
    // a escolha da filial termina de carregar (o next dev ainda navega logo depois da URL)
    await p.getByRole('radio').first().waitFor();
    await p.waitForLoadState('networkidle').catch(() => undefined);
    const opcoes = (await p.locator('label').allTextContents()).join(' | ');
    exigir((await p.getByRole('radio').count()) === 2, `esperava 2 filiais: ${opcoes}`);
    exigir(opcoes.includes('Matriz Manaus') && opcoes.includes('Filial Parintins'), `filiais: ${opcoes}`);
    exigir(!opcoes.includes('Boa Vista'), 'vazou a filial do tenant B');
    await print(p, '03-selecionar-filial-tenant-a.png');
  });

  await passo('tenant A: topo com a empresa e a filial de A; menu com Cadastros, Pedidos e Faturamento; nada de B', async () => {
    await p.getByLabel(/Matriz Manaus/).check();
    await p.getByRole('button', { name: /Continuar|Entrar|Selecionar/ }).click();
    await p.waitForURL((u) => new URL(u).pathname === '/');
    const t = await topo();
    exigir(t.includes(EMPRESA_A) && t.includes('Matriz Manaus'), `topo sem empresa/filial: ${t}`);
    exigir(!t.includes(EMPRESA_B) && !t.includes('Boa Vista'), 'vazou o tenant B no topo');
    await abrirGrupo('Cadastros');
    const itens = (await nav().getByRole('region', { name: 'Cadastros' }).getByRole('link').allTextContents()).map((s) => s.trim());
    exigir(JSON.stringify(itens) === JSON.stringify(MENU_CADASTROS), `itens: ${JSON.stringify(itens)}`);
    for (const oculto of OCULTOS_CADASTROS) exigir(!itens.includes(oculto), `item sem tela no menu: ${oculto}`);
    const menu = (await nav().textContent()) ?? '';
    exigir(menu.includes('Pedidos') && menu.includes('Notas fiscais'), 'faltou módulo licenciado de A');
    exigir(!/Regras fiscais|Integração FDV/.test(menu), 'menu mostra módulo sem licença');
    await print(p, '04-inicio-tenant-a.png');
  });

  for (const rotulo of LISTAS_DO_MENU) {
    await passo(`tenant A: Cadastros > ${rotulo} abre a lista com o título e marca o item atual, sem aviso de falha nem "Disponível em breve"`, async () => {
      await abrirGrupo('Cadastros');
      await nav().getByRole('link', { name: rotulo, exact: true }).click();
      await p.getByRole('heading', { level: 1, name: rotulo }).waitFor();
      const atual = await p.getByRole('link', { name: rotulo, exact: true }).getAttribute('aria-current');
      exigir(atual === 'page', `aria-current=${atual}`);
      const main = (await p.locator('main').textContent()) ?? '';
      exigir(!/Não foi possível carregar/.test(main), `aviso de falha: ${main.slice(0, 120)}`);
      exigir(!main.includes('Disponível em breve'), `a página ainda é "Disponível em breve": ${main.slice(0, 120)}`);
      await p.locator('main table').first().waitFor();
    });
  }

  await passo('tenant A: Estoque (T-0123) lista o saldo com filial e produto pelo nome, saldo 1.250 (milhar com ponto); busca e filtro de filial vão à API', async () => {
    await abrirGrupo('Cadastros');
    await nav().getByRole('link', { name: 'Estoque', exact: true }).click();
    await p.waitForURL((u) => new URL(u).pathname === '/cadastros/estoque');
    await p.getByRole('heading', { level: 1, name: 'Estoque' }).waitFor();
    await p.locator('main tbody tr').first().waitFor();
    let linhas = await linhasDaLista();
    exigir(linhas.length === 1, `esperava 1 saldo: ${JSON.stringify(linhas)}`);
    exigir(linhas[0].includes('Matriz Manaus') && linhas[0].includes(PRODUTO_ESTOQUE) && linhas[0].includes('1.250'), `linha do saldo: ${linhas[0]}`);
    exigir(!UUID.test(linhas[0]), `UUID na linha (filial ou produto sem nome): ${linhas[0]}`);
    exigir(!/Novo|Exportar CSV/.test(await textoMain()), 'lista só de leitura com botão de escrita ou CSV');
    await print(p, '04c-estoque-tenant-a.png');
    await filtrar('busca', 'sem-saldo-e2e');
    exigir((await textoMain()).includes('Nenhum saldo com estes filtros.'), `busca sem resultado: ${JSON.stringify(await linhasDaLista())}`);
    await filtrar('busca', '');
    await filtrar('filial_id', await valorDaOpcao('filial_id', 'Filial Parintins'));
    exigir((await textoMain()).includes('Nenhum saldo com estes filtros.'), `filtro da filial Parintins: ${JSON.stringify(await linhasDaLista())}`);
    await filtrar('filial_id', await valorDaOpcao('filial_id', 'Matriz Manaus'));
    linhas = await linhasDaLista();
    exigir(linhas.length === 1 && linhas[0].includes(PRODUTO_ESTOQUE), `filtro da Matriz: ${JSON.stringify(linhas)}`);
  });

  await passo('tenant A: Tabelas oficiais (T-0123) abre no NCM vigente; a busca pelo código acha 2202.10.00; só leitura', async () => {
    await abrirGrupo('Cadastros');
    await nav().getByRole('link', { name: 'Tabelas oficiais', exact: true }).click();
    await p.waitForURL((u) => new URL(u).pathname === '/cadastros/oficiais');
    await p.getByRole('heading', { level: 1, name: 'NCM' }).waitFor();
    await p.locator('main tbody tr').first().waitFor();
    exigir((await linhasDaLista()).length > 1, 'NCM sem linhas (carga oficial)');
    exigir(!/Novo|Exportar CSV/.test(await textoMain()), 'tabela oficial com botão de escrita ou CSV');
    await print(p, '04d-oficiais-ncm.png');
    await filtrar('busca', '22021000');
    const linhas = await linhasDaLista();
    exigir(linhas.length >= 1 && linhas.every((l) => l.includes('2202.10.00')), `busca do NCM 22021000: ${JSON.stringify(linhas.slice(0, 3))}`);
  });

  await passo('tenant A: Tabelas oficiais > CEST lista o código no formato 00.000.00 e o segmento', async () => {
    await p.goto(`${BASE}/cadastros/oficiais`);
    await p.getByRole('heading', { level: 1, name: 'NCM' }).waitFor();
    await abrirSecao('CEST', '/cadastros/oficiais/cest');
    const linhas = await linhasDaLista();
    exigir(linhas.length > 1 && linhas.every((l) => /\d{2}\.\d{3}\.\d{2}/.test(l)), `CEST: ${JSON.stringify(linhas.slice(0, 3))}`);
    await filtrar('busca', '0100100');
    const achadas = await linhasDaLista();
    exigir(achadas.length >= 1 && achadas.every((l) => l.includes('01.001.00')) && achadas[0].includes('AUTOPEÇAS'), `busca do CEST 0100100: ${JSON.stringify(achadas)}`);
  });

  await passo('tenant A: Tabelas oficiais > CFOP, a busca por 5102 acha a venda de mercadoria de terceiros', async () => {
    await abrirSecao('CFOP', '/cadastros/oficiais/cfop');
    await filtrar('busca', '5102');
    const linhas = await linhasDaLista();
    exigir(linhas.some((l) => l.startsWith('5102') && l.includes('Venda de mercadoria adquirida ou recebida de terceiros')), `CFOP 5102: ${JSON.stringify(linhas.slice(0, 3))}`);
  });

  await passo('tenant A: Tabelas oficiais > Municípios (IBGE), o filtro de UF vai à API (só AM) e a busca acha Manaus 1302603', async () => {
    await abrirSecao('Municípios (IBGE)', '/cadastros/oficiais/ibge');
    const ufs = (await campoFiltro('uf').locator('option').allTextContents()).map((t) => t.trim());
    exigir(ufs[0] === 'Todas' && ufs.length === 28 && ufs.includes('AM') && ufs.includes('RR'), `opções de UF: ${ufs.join(',')}`);
    await filtrar('uf', 'AM');
    let linhas = await linhasDaLista();
    exigir(linhas.length > 1 && linhas.every((l) => /\bAM\b/.test(l) && !/\b(RR|RO|PA|AC)\b/.test(l)), `UF AM: ${JSON.stringify(linhas.slice(0, 3))}`);
    await filtrar('busca', 'Manaus');
    linhas = await linhasDaLista();
    exigir(linhas.length === 1 && linhas[0].includes('1302603') && linhas[0].includes('Manaus'), `Manaus em AM: ${JSON.stringify(linhas)}`);
    await print(p, '04e-oficiais-ibge-am.png');
    await filtrar('uf', 'RR');
    exigir((await textoMain()).includes('Nenhum registro de Municípios (IBGE) com estes filtros.'), `Manaus em RR: ${JSON.stringify(await linhasDaLista())}`);
    await filtrar('busca', 'Boa Vista');
    linhas = await linhasDaLista();
    exigir(linhas.length === 1 && linhas[0].includes('1400100') && /\bRR\b/.test(linhas[0]), `Boa Vista em RR: ${JSON.stringify(linhas)}`);
  });

  await passo('tenant A: Condições de pagamento (T-0123, lote B) cria a condição Boleto 30/60/90 pela tela; a lista mostra as parcelas e o prazo médio 60', async () => {
    await p.goto(`${BASE}/cadastros/condicoes-pagamento`);
    await p.getByRole('heading', { level: 1, name: 'Condições de pagamento' }).waitFor();
    await p.locator('main').getByRole('link', { name: 'Nova condição', exact: true }).click();
    await p.waitForURL((u) => new URL(u).pathname === '/cadastros/condicoes-pagamento/novo');
    await p.locator('#campo-codigo').fill('B306090');
    await p.locator('#campo-descricao').fill('Boleto 30/60/90 e2e');
    await p.locator('#campo-forma_tpag').selectOption('15');
    await p.locator('#campo-parcelas').fill('30/60/90');
    await print(p, '04f-condicao-nova.png');
    await salvarEVoltar('Salvar condição', '/cadastros/condicoes-pagamento');
    const linha = await textoDaLinha('B306090');
    // Prazo médio de 30/60/90 = 60 dias (RN-CAD-15), calculado pela API e mostrado na lista.
    exigir(linha.includes('Boleto 30/60/90 e2e') && / 30\/60\/90 60( |$)/.test(linha), `linha da condição: ${linha}`);
  });

  await passo('tenant A: Condições de pagamento, a edição abre com "30/60/90" e grava a parcela de 120 dias e a descrição nova (PATCH)', async () => {
    await linhaCom('B306090').first().click();
    await p.waitForURL((u) => /^\/cadastros\/condicoes-pagamento\/[0-9a-f-]{36}$/.test(new URL(u).pathname));
    await p.locator('#campo-parcelas').waitFor();
    const parcelas = await p.locator('#campo-parcelas').inputValue();
    exigir(parcelas === '30/60/90', `parcelas na edição: ${parcelas}`);
    exigir((await p.locator('#campo-codigo').inputValue()) === 'B306090', 'código não veio na edição');
    await p.locator('#campo-descricao').fill('Boleto 30/60/90/120 e2e');
    await p.locator('#campo-parcelas').fill('30/60/90/120');
    await p.locator('#campo-prazo_medio_dias').fill('');
    await salvarEVoltar('Salvar alterações', '/cadastros/condicoes-pagamento');
    const linha = await textoDaLinha('B306090');
    // Prazo médio vazio na edição = recalculado pelas parcelas: (30 + 60 + 90 + 120) / 4 = 75 dias.
    exigir(linha.includes('Boleto 30/60/90/120 e2e') && / 30\/60\/90\/120 75( |$)/.test(linha), `linha depois da edição: ${linha}`);
    await print(p, '04g-condicoes-lista.png');
  });

  await passo('tenant A: Equipe e carteira (lote B) cria a vendedora V02 na Filial Parintins; a lista mostra a filial pelo nome', async () => {
    await p.goto(`${BASE}/cadastros/equipe`);
    await p.getByRole('heading', { level: 1, name: 'Equipe e carteira' }).waitFor();
    await linhaCom(VENDEDOR_ORIGEM).first().waitFor();
    await p.locator('main').getByRole('link', { name: 'Novo vendedor', exact: true }).click();
    await p.waitForURL((u) => new URL(u).pathname === '/cadastros/equipe/novo');
    await p.locator('#campo-codigo').fill('V02');
    await p.locator('#campo-nome').fill('Vendedora Parintins');
    await escolher('filial_id', 'Filial Parintins');
    await salvarEVoltar('Salvar vendedor', '/cadastros/equipe');
    const linha = await textoDaLinha('V02');
    exigir(linha.includes('Vendedora Parintins') && linha.includes('Filial Parintins') && !UUID.test(linha), `linha da vendedora: ${linha}`);
  });

  await passo('tenant A: Equipe e carteira, a edição da V02 grava o nome novo (PATCH) e o filtro da filial vai à API', async () => {
    await linhaCom('V02').first().click();
    await p.waitForURL((u) => /^\/cadastros\/equipe\/[0-9a-f-]{36}$/.test(new URL(u).pathname));
    await p.locator('#campo-nome').waitFor();
    exigir((await p.locator('#campo-nome').inputValue()) === 'Vendedora Parintins', 'nome não veio na edição');
    await p.locator('#campo-nome').fill('Vendedora Parintins Centro');
    await salvarEVoltar('Salvar alterações', '/cadastros/equipe');
    exigir((await textoDaLinha('V02')).includes('Vendedora Parintins Centro'), 'o nome editado não voltou na lista');
    await filtrar('filial_id', await valorDaOpcao('filial_id', 'Filial Parintins'));
    const linhas = await linhasDaLista();
    exigir(linhas.length === 1 && linhas[0].includes('V02'), `filtro da Filial Parintins: ${JSON.stringify(linhas)}`);
    await print(p, '04h-equipe-lista.png');
  });

  await passo('tenant A: Transferir carteira (D7) leva o cliente da V01 para a V02; a segunda transferência acusa a carteira vazia', async () => {
    await p.goto(`${BASE}/cadastros/equipe`);
    await p.getByRole('heading', { level: 1, name: 'Equipe e carteira' }).waitFor();
    await p.locator('main').getByRole('link', { name: 'Transferir carteira', exact: true }).first().click();
    await p.waitForURL((u) => new URL(u).pathname === '/cadastros/equipe/transferir');
    await p.locator('#campo-de').waitFor();
    const transferir = async () => {
      await escolher('de', VENDEDOR_ORIGEM);
      await escolher('para', 'Vendedora Parintins Centro');
    };
    await transferir();
    await print(p, '04i-transferir-carteira.png');
    await salvarEVoltar('Transferir carteira', '/cadastros/equipe');
    await p.goto(`${BASE}/cadastros/equipe/transferir`);
    await p.locator('#campo-de').waitFor();
    await transferir();
    await p.getByRole('button', { name: 'Transferir carteira', exact: true }).click();
    const erro = p.locator('main [data-resultado-acao="erro"]');
    await erro.waitFor({ timeout: 30_000 });
    exigir(new URL(p.url()).pathname === '/cadastros/equipe/transferir', `saiu do formulário: ${p.url()}`);
    const texto = (await erro.innerText()).replace(/\s+/g, ' ').trim();
    exigir(texto.includes('Nenhum cliente para transferir'), `mensagem da carteira vazia: ${texto}`);
  });

  await passo('tenant A: Usuários lista só os usuários de A (RLS na lista), cada linha com o botão "Ações" (T-0099), nada de B', async () => {
    await p.goto(`${BASE}/core/usuarios`);
    await p.getByRole('heading', { level: 1, name: 'Usuários' }).waitFor();
    await p.locator('main tbody tr').first().waitFor();
    const linhas = (await p.locator('main tbody tr').allTextContents()).join(' | ');
    exigir(linhas.includes(ADM_A.email) && linhas.includes(VEND_A.email), `usuários de A na lista: ${linhas.slice(0, 200)}`);
    exigir(!linhas.includes(ADM_B.email), 'vazou o usuário do tenant B na lista');
    const total = await p.locator('main tbody tr').count();
    const comAcoes = await p.locator('main tbody tr').filter({ has: p.locator('.mx-acoes-gatilho') }).count();
    exigir(comAcoes === total, `linhas com o botão Ações: ${comAcoes} de ${total}`);
    await print(p, '04b-usuarios-tenant-a.png');
  });

  await passo('tenant A: Licenças lista só os módulos contratados (cadastros, pedido e faturamento), ativos; fiscal e integração fora', async () => {
    await p.getByRole('main').getByRole('link', { name: 'Licenças', exact: true }).click();
    await p.getByRole('heading', { level: 1, name: 'Licenças' }).waitFor();
    const linhas = (await p.locator('main tbody tr').allTextContents()).map((l) => l.trim());
    const nomes = linhas.map((l) => l.match(/^(Cadastros|Pedidos|Faturamento|Fiscal|Integração FDV|Core)/)?.[1] ?? l.slice(0, 30)).sort();
    exigir(JSON.stringify(nomes) === JSON.stringify(['Cadastros', 'Faturamento', 'Pedidos']), `módulos na tela: ${nomes.join(', ')}`);
    exigir(linhas.every((l) => l.includes('Ativa')), `licença não ativa: ${linhas.join(' | ')}`);
    await print(p, '05-licencas-tenant-a.png', { x: 290, y: 70, width: 1030, height: 496 });
  });

  await passo('RN-CORE-02: página de módulo sem licença no tenant (fiscal) é "não encontrada"', async () => {
    const r = await p.goto(`${BASE}/fiscal/regras-fiscais`);
    await exigirNaoEncontrada(r);
  });

  await passo('tenant A, vendedor de uma filial: entra direto, sem Faturamento no menu (perfil fora do manifesto)', async () => {
    await p.goto(`${BASE}/`);
    await sair();
    await entrar(VEND_A);
    await p.waitForURL((u) => new URL(u).pathname === '/');
    const t = await topo();
    exigir(t.includes(EMPRESA_A) && t.includes('Matriz Manaus'), `topo: ${t}`);
    const menu = (await nav().textContent()) ?? '';
    exigir(menu.includes('Clientes') && menu.includes('Pedidos'), 'faltou Cadastros ou Pedidos');
    exigir(!menu.includes('Notas fiscais'), 'vendedor vê Faturamento');
  });

  await passo('RN-CORE-02: tela sem permissão — vendedor em /faturamento/notas-fiscais (módulo licenciado, perfil sem acesso) é "não encontrada"', async () => {
    const r = await p.goto(`${BASE}/faturamento/notas-fiscais`);
    await exigirNaoEncontrada(r);
    await print(p, '06-sem-permissao-404.png');
  });

  await passo('tenant B em 1024 px: empresa e filial de B, só Cadastros licenciado; nada de A', async () => {
    await p.goto(`${BASE}/`);
    await sair();
    await p.setViewportSize({ width: 1024, height: 768 });
    await entrar(ADM_B);
    await p.waitForURL((u) => new URL(u).pathname === '/');
    const t = await topo();
    exigir(t.includes(EMPRESA_B) && t.includes('Loja Boa Vista'), `topo: ${t}`);
    exigir(!t.includes(EMPRESA_A) && !t.includes('Manaus') && !t.includes('Parintins'), 'vazou o tenant A no topo');
    const menu = (await nav().textContent()) ?? '';
    exigir(menu.includes('Clientes') && !menu.includes('Pedidos') && !menu.includes('Notas fiscais'), `menu de B: ${menu}`);
    await print(p, '07-inicio-tenant-b-1024.png');
  });

  await passo('tenant B: o Estoque de B não mostra o saldo de A (RLS na lista do estoque)', async () => {
    await p.goto(`${BASE}/cadastros/estoque`);
    await p.getByRole('heading', { level: 1, name: 'Estoque' }).waitFor();
    await p.locator('main table').first().waitFor();
    const main = await textoMain();
    exigir(main.includes('Nenhum saldo de estoque lançado.') && !main.includes(PRODUTO_ESTOQUE), `estoque de B: ${main.slice(0, 160)}`);
  });

  await passo('tenant B: /pedido/pedidos é "não encontrada" (licenciado em A, não em B: a licença é por tenant)', async () => {
    const r = await p.goto(`${BASE}/pedido/pedidos`);
    await exigirNaoEncontrada(r);
  });

  await passo('Sair encerra a sessão e volta ao login', async () => {
    await p.goto(`${BASE}/`);
    await sair();
    await p.goto(`${BASE}/cadastros/clientes`);
    await exigirLogin();
  });
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, passos: resultados.length, ok: resultados.length - falhas.length, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
