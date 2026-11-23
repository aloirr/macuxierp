#!/usr/bin/env node
/**
 * T-0008 (d), parte 2: e2e do BKO de cadastro com o Playwright, contra a API REAL (montarModulos de produção, adaptadores
 * SQL, Postgres local, RLS no papel macuxierp_app) com DOIS tenants (`tests/e2e/api-real.ts`).
 * Fora do vitest (não é *.test.ts) porque o @playwright/test não está no package.json: usa o Playwright instalado
 * globalmente (require('playwright'), Chromium já instalado; sem `playwright install`, sem trace).
 *
 * O shell do main ainda não desenha as listas: a página de módulo mostra "Esta tela ainda não foi construída". Colunas,
 * filtros, CSV e custo por perfil estão provados contra a API em tests/integracao/web/listas-bko.db.test.ts; aqui fica o
 * que a tela já mostra de cada tenant: empresa, filiais, menu e licenças, e o 404 por licença e por perfil.
 *
 * Uso (pg-local.sh de pé; ver docs/testes/T-0008.md, seção (d)):
 *   1. vite-node tests/e2e/api-real.ts -- --porta 3200 --pronto <dados.json>
 *   2. cd apps/web && MACUXIERP_API_URL=http://127.0.0.1:3200 npx next dev -p 3100
 *   3. node tests/e2e/bko-cadastro.mjs --base http://localhost:3100 --dados <dados.json> --saida <pasta dos prints>
 * Prints em PNG do viewport, deviceScaleFactor 2. Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argumento, criarRoteiro, exigir } from './apoio-e2e.mjs';

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
const MENU_CADASTROS = ['Clientes', 'Produtos', 'Tabelas de preço', 'Estoque', 'Condições de pagamento', 'Equipe e carteira', 'Filiais', 'Tabelas oficiais'];
// T-0026: o administrador vê também a carga (cadastros.carga.executar), que tem tela própria, fora do passo das listas.
const MENU_CADASTROS_ADM = [...MENU_CADASTROS, 'Carga de cadastros'];

const { resultados, prints, passo, print } = criarRoteiro(SAIDA);

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' });
const p = await contexto.newPage();
// O next dev compila cada página no primeiro acesso: prazo maior que o padrão.
p.setDefaultTimeout(60_000);

const nav = () => p.getByRole('navigation', { name: 'Menu principal' });
const topo = async () => (await p.locator('header.topo').textContent()) ?? '';
async function entrar(u, senha = u.senha) {
  await p.getByLabel('Empresa').fill(u.empresa);
  await p.getByLabel('E-mail').fill(u.email);
  await p.getByLabel('Senha').fill(senha);
  await p.getByRole('button', { name: 'Entrar' }).click();
}
async function sair() {
  await p.getByRole('button', { name: 'Sair' }).click();
  await p.waitForURL(/\/login/);
}

try {
  await passo('sem sessão, a raiz manda para o login', async () => {
    await p.goto(`${BASE}/`);
    await p.waitForURL(/\/login/);
    exigir(await p.getByRole('button', { name: 'Entrar' }).isVisible(), 'sem o botão Entrar');
    await print(p, '01-login.png');
  });

  await passo('RLS no login: e-mail e senha certos do tenant A na empresa B são recusados (a senha não volta)', async () => {
    await entrar({ ...ADM_A, empresa: 'loja-b' });
    // O Next também tem um role=alert (anúncio de rota): o do formulário é o p.erro.
    const alerta = p.locator('form p.erro[role="alert"]');
    await alerta.waitFor();
    const texto = await alerta.textContent();
    exigir(texto?.includes('incorretos'), `mensagem de erro diferente: ${texto}`);
    exigir((await p.getByLabel('E-mail').inputValue()) === ADM_A.email, 'o e-mail se perdeu');
    exigir((await p.getByLabel('Senha').inputValue()) === '', 'a senha voltou para a tela');
    await print(p, '02-login-erro-outro-tenant.png');
  });

  await passo('tenant A, administrador com duas filiais: a escolha mostra só as filiais de A', async () => {
    await entrar(ADM_A);
    await p.waitForURL(/\/filial/);
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
    const itens = (await nav().getByRole('region', { name: 'Cadastros' }).getByRole('link').allTextContents()).map((s) => s.trim());
    exigir(JSON.stringify(itens) === JSON.stringify(MENU_CADASTROS_ADM), `itens: ${JSON.stringify(itens)}`);
    const menu = (await nav().textContent()) ?? '';
    exigir(menu.includes('Pedidos') && menu.includes('Notas fiscais'), 'faltou módulo licenciado de A');
    exigir(!/Regras fiscais|Integração FDV/.test(menu), 'menu mostra módulo sem licença');
    await print(p, '04-inicio-tenant-a.png');
  });

  for (const rotulo of MENU_CADASTROS) {
    await passo(`tenant A: Cadastros > ${rotulo} abre a página com o título e marca o item atual (lista ainda não construída no shell)`, async () => {
      await nav().getByRole('link', { name: rotulo, exact: true }).click();
      await p.getByRole('heading', { level: 1, name: rotulo }).waitFor();
      const atual = await p.getByRole('link', { name: rotulo, exact: true }).getAttribute('aria-current');
      exigir(atual === 'page', `aria-current=${atual}`);
      exigir((await p.locator('main').textContent())?.includes('ainda não foi construída'), 'a página mudou: trocar este passo pelo da lista');
    });
  }

  await passo('tenant A: Licenças mostra cadastros, pedido e faturamento contratados; fiscal e integração não contratados', async () => {
    await p.getByRole('link', { name: 'Licenças' }).click();
    await p.getByRole('heading', { level: 1, name: 'Licenças' }).waitFor();
    const linhas = await p.locator('tbody tr').allTextContents();
    exigir(linhas.length === 6, 'esperava os 6 módulos da v1');
    const contratados = linhas.filter((l) => l.includes('Contratado')).length;
    exigir(contratados === 4, `esperava core + 3 contratados, vieram ${contratados}`);
    await print(p, '05-licencas-tenant-a.png', { x: 290, y: 70, width: 1030, height: 496 });
  });

  await passo('RN-CORE-02: página de módulo sem licença no tenant (fiscal) é 404', async () => {
    const r = await p.goto(`${BASE}/fiscal/regras-fiscais`);
    exigir(r?.status() === 404, `status ${r?.status()}`);
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

  await passo('RN-CORE-02: tela sem permissão — vendedor em /faturamento/notas-fiscais (módulo licenciado, perfil sem acesso) = 404', async () => {
    const r = await p.goto(`${BASE}/faturamento/notas-fiscais`);
    exigir(r?.status() === 404, `status ${r?.status()}`);
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

  await passo('tenant B: /pedido/pedidos é 404 (licenciado em A, não em B: a licença é por tenant)', async () => {
    const r = await p.goto(`${BASE}/pedido/pedidos`);
    exigir(r?.status() === 404, `status ${r?.status()}`);
  });

  await passo('Sair encerra a sessão e volta ao login', async () => {
    await p.goto(`${BASE}/`);
    await sair();
    await p.goto(`${BASE}/cadastros/clientes`);
    await p.waitForURL(/\/login/);
  });
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, passos: resultados.length, ok: resultados.length - falhas.length, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
