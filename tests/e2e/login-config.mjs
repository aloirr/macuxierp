#!/usr/bin/env node
/**
 * R-20261127-061730 (v0.3.20, prioridade crítica do Alexandre), atualizado para o login único na raiz (v0.3.27, #886, decisão
 * 42 = A): e2e do login único entre o BKO e o portal /config, com as telas reais (next dev) e a API real
 * (`tests/e2e/api-login-config.ts`, Postgres local). Só dado fictício, nunca a rede.
 *
 * Fluxo atual: a tela de login é "/" sem sessão; /login e /config/entrar respondem 308 para "/" (o fragmento fica); não há
 * mais campo `destino`: quem decide BKO ou /config é a API, pelo código da empresa (MACUXI = portal). O esperado:
 * - /config sem sessão do portal volta a "/" com o campo Empresa = MACUXI (`#codigo=MACUXI`, `ROTA_LOGIN_SUPERADMIN`), acima
 *   do código salvo do BKO (`lib/codigo-salvo.ts`), e o fragmento sai da barra;
 * - o Entrar com MACUXI abre o /config, nunca a tela do BKO, e não troca o código salvo da empresa;
 * - o link do e-mail (`/login#codigo=…&email=…`, rota antiga, e `/#codigo=…`) preenche os dois campos e limpa o hash;
 *   a senha nunca vem do link.
 *
 * Uso: `bash tests/e2e/rodar-login-config.sh [pasta dos prints]`, ou à mão:
 *   node tests/e2e/login-config.mjs --base http://localhost:3104 --dados <json da API> --saida <pasta dos prints>
 * Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argumento, criarRoteiro, entrar, exigir } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3104');
const SAIDA = argumento('saida', null);
const DADOS = argumento('dados', null);
if (!SAIDA || !DADOS) {
  console.error('uso: node tests/e2e/login-config.mjs --base <url do web> --dados <json do api-login-config.ts> --saida <pasta dos prints>');
  process.exit(2);
}
mkdirSync(SAIDA, { recursive: true });

const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
const { administrador: adm, superadmin: sa } = dados;
/** Código da empresa como o login o guarda (maiúsculo, `CodigoEmpresaLogin`). */
const CODIGO_EMPRESA = adm.empresa.toUpperCase();
/** Texto fictício posto no link para provar que a senha nunca sai dele. */
const SENHA_NO_LINK = 'Senha-ficticia-no-link-9';
const CHAVE_CODIGO = 'mx.codigo_empresa';

const { resultados, passo, prints, print } = criarRoteiro(SAIDA, (s) => s.replaceAll(sa.senha, '<senha>').replaceAll(adm.senha, '<senha>'));

const navegador = await chromium.launch();
const opcoes = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Manaus' };
/** Página num contexto novo; `codigoSalvo` entra no localStorage antes de a primeira página carregar. */
const novaPagina = async (codigoSalvo) => {
  const ctx = await navegador.newContext(opcoes);
  if (codigoSalvo) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [CHAVE_CODIGO, codigoSalvo]);
  const p = await ctx.newPage();
  p.setDefaultTimeout(90_000); // o next dev compila cada página no primeiro acesso
  return p;
};

const campo = (p, nome) => p.locator(`form input[name="${nome}"]`);
const caminho = (p) => new URL(p.url()).pathname;
/** O login guarda o código em maiúsculo; o SDK escreve o da plataforma como quiser: a comparação ignora caixa. */
const mesmoCodigo = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
/** Valores dos campos depois do efeito de montagem do formulário (código salvo ou fragmento do link, que sai da barra). */
async function camposDoLogin(p, { empresa, email } = {}) {
  await campo(p, 'email').waitFor();
  const pronto = ([emp, e]) => {
    const v = (n) => document.querySelector(`form input[name="${n}"]`)?.value ?? '';
    return location.hash === '' && (!emp || v('empresa').toUpperCase() === emp.toUpperCase()) && (!e || v('email') === e);
  };
  await p.waitForFunction(pronto, [empresa, email], { timeout: 10_000 }).catch(() => undefined);
  return {
    empresa: await campo(p, 'empresa').inputValue(),
    email: await campo(p, 'email').inputValue(),
    senha: await p.getByLabel('Senha', { exact: true }).inputValue(),
    destinos: await campo(p, 'destino').count(),
  };
}

let pagina;
try {
  pagina = await novaPagina();

  await passo('(1) a pessoa entra no BKO pela raiz com o código da empresa fictícia; termina em "/" no BKO e o login guarda o código', async () => {
    await pagina.goto(`${BASE}/`);
    await campo(pagina, 'email').waitFor();
    exigir(caminho(pagina) === '/', `a raiz sem sessão saiu para ${caminho(pagina)}`);
    await entrar(pagina, BASE, adm);
    await pagina.getByRole('heading', { name: 'Início' }).waitFor({ timeout: 30_000 });
    exigir(caminho(pagina) === '/', `BKO em ${caminho(pagina)}`);
    const salvo = await pagina.evaluate((k) => localStorage.getItem(k), CHAVE_CODIGO);
    exigir(salvo === CODIGO_EMPRESA, `código salvo: ${salvo}`);
  });

  await passo('(2) rotas antigas do login: /login, /login?destino=/config e /config/entrar respondem 308 para "/"', async () => {
    for (const c of ['/login', '/login?destino=%2Fconfig', '/config/entrar']) {
      const r = await fetch(`${BASE}${c}`, { redirect: 'manual' });
      const loc = r.headers.get('location') ?? '';
      exigir(r.status === 308 && new URL(loc, BASE).pathname === '/', `${c} -> ${r.status} Location ${loc}`);
    }
  });

  const portal = await novaPagina();
  await passo('(3) /config sem sessão do portal, com o código da empresa salvo: volta a "/" com Empresa = MACUXI, sem campo destino, nunca o BKO', async () => {
    await portal.goto(`${BASE}/`);
    await portal.evaluate(([k, v]) => localStorage.setItem(k, v), [CHAVE_CODIGO, CODIGO_EMPRESA]);
    await portal.goto(`${BASE}/config`);
    await portal.waitForURL((u) => new URL(u).pathname === '/');
    const v = await camposDoLogin(portal, { empresa: sa.empresa });
    exigir(mesmoCodigo(v.empresa, sa.empresa), `campo Empresa: ${v.empresa} (esperado ${sa.empresa})`);
    exigir(v.email === '' && v.senha === '', 'e-mail e senha não vêm preenchidos');
    exigir(v.destinos === 0, 'o formulário ainda tem o campo destino');
    exigir((await portal.evaluate(() => location.hash)) === '', 'o fragmento #codigo ficou na barra de endereço');
    await print(portal, '01-config-vai-ao-login-macuxi.png');
  });

  await passo('(4) Entrar sem mexer na Empresa abre o portal /config, nunca a tela do BKO, e não troca o código salvo', async () => {
    await campo(portal, 'email').fill(sa.email);
    await portal.getByLabel('Senha', { exact: true }).fill(sa.senha);
    await portal.getByRole('button', { name: 'Entrar', exact: true }).click();
    await portal.waitForURL((u) => new URL(u).pathname.startsWith('/config'), { timeout: 30_000 });
    await portal.waitForLoadState('networkidle').catch(() => undefined);
    exigir(caminho(portal).startsWith('/config'), `abriu ${caminho(portal)}`);
    exigir((await portal.getByText('Boas-vindas ao Macuxi ERP').count()) === 0, 'abriu a tela do BKO');
    const salvo = await portal.evaluate((k) => localStorage.getItem(k), CHAVE_CODIGO);
    exigir(salvo === CODIGO_EMPRESA, `o login do portal não troca o código salvo da empresa: ${salvo}`);
    await print(portal, '02-portal-config-aberto.png');
    await portal.context().close();
  });

  await passo('(5) link do e-mail do superadmin na rota antiga (/login#…), com o código da empresa salvo: cai em "/", Empresa = MACUXI e o e-mail preenchidos, hash limpo', async () => {
    const p = await novaPagina(CODIGO_EMPRESA);
    await p.goto(`${BASE}/login#codigo=${encodeURIComponent(sa.empresa)}&email=${encodeURIComponent(sa.email)}`);
    const v = await camposDoLogin(p, { empresa: sa.empresa, email: sa.email });
    exigir(caminho(p) === '/', `o link terminou em ${caminho(p)}`);
    exigir(mesmoCodigo(v.empresa, sa.empresa), `campo Empresa: ${v.empresa} (esperado ${sa.empresa})`);
    exigir(v.email === sa.email, 'campo E-mail não veio do link');
    exigir(v.senha === '', 'senha preenchida');
    exigir((await p.evaluate(() => location.hash)) === '', 'o hash do link ficou na barra de endereço');
    await print(p, '03-link-email-superadmin.png');
    await p.context().close();
  });

  await passo('(6) link do e-mail da empresa na raiz com "senha" no hash: código e e-mail preenchidos, senha vazia, hash limpo', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/#codigo=${encodeURIComponent(adm.empresa)}&email=${encodeURIComponent(adm.email)}&senha=${encodeURIComponent(SENHA_NO_LINK)}`);
    const v = await camposDoLogin(p, { empresa: adm.empresa, email: adm.email });
    exigir(mesmoCodigo(v.empresa, CODIGO_EMPRESA), `campo Empresa: ${v.empresa} (esperado ${CODIGO_EMPRESA})`);
    exigir(v.email === adm.email, 'campo E-mail não veio do link');
    exigir(v.senha === '', 'a senha veio do link');
    exigir((await p.evaluate(() => location.hash)) === '', 'o hash do link ficou na barra de endereço');
    exigir(!(await p.content()).includes(SENHA_NO_LINK), 'o texto da senha do link aparece no HTML');
    await p.context().close();
  });
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, passos: resultados.length, ok: resultados.length - falhas.length, falhas, prints }, null, 2));
process.exit(falhas.length ? 1 : 0);
