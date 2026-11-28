#!/usr/bin/env node
/**
 * R-20261127-061730 (v0.3.20, prioridade crítica do Alexandre), atualizado para o login único na raiz (v0.3.27, #886, decisão
 * 42 = A): e2e do login único entre o BKO e o portal /config, com as telas reais (next dev) e a API real
 * (`tests/e2e/api-login-config.ts`, Postgres local). Só dado fictício, nunca a rede.
 *
 * Fluxo atual (ADR 0021, T-0133): a tela de login é "/" sem sessão, só com E-mail e Senha; /login e /config/entrar
 * respondem 308 para "/" (o fragmento fica). Quem decide BKO ou /config é a API, pelo e-mail. O esperado:
 * - a administradora com o mesmo e-mail de um superadmin entra no BKO (opção A);
 * - /config sem sessão do portal volta a "/" sem fragmento, com os campos vazios e sem campo Empresa;
 * - o e-mail só de superadmin abre o /config, nunca a tela do BKO;
 * - o link do e-mail (`/login#email=…`, rota antiga, e `/#email=…`) preenche o e-mail e limpa o hash; a senha nunca vem do link.
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
/** Texto fictício posto no link para provar que a senha nunca sai dele. */
const SENHA_NO_LINK = 'Senha-ficticia-no-link-9';

const { resultados, passo, prints, print } = criarRoteiro(SAIDA, (s) => s.replaceAll(sa.senha, '<senha>').replaceAll(adm.senha, '<senha>'));

const navegador = await chromium.launch();
const opcoes = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Manaus' };
const novaPagina = async () => {
  const p = await (await navegador.newContext(opcoes)).newPage();
  p.setDefaultTimeout(90_000); // o next dev compila cada página no primeiro acesso
  return p;
};

const campo = (p, nome) => p.locator(`form input[name="${nome}"]`);
const caminho = (p) => new URL(p.url()).pathname;
/** Valores dos campos depois do efeito de montagem do formulário (fragmento do link, que sai da barra). */
async function camposDoLogin(p, { email } = {}) {
  await campo(p, 'email').waitFor();
  const pronto = (e) => location.hash === '' && (!e || document.querySelector('form input[name="email"]')?.value === e);
  await p.waitForFunction(pronto, email, { timeout: 10_000 }).catch(() => undefined);
  return {
    email: await campo(p, 'email').inputValue(),
    senha: await p.getByLabel('Senha', { exact: true }).inputValue(),
    empresas: (await campo(p, 'empresa').count()) + (await p.getByLabel('Empresa').count()),
    destinos: await campo(p, 'destino').count(),
  };
}

let pagina;
try {
  pagina = await novaPagina();

  await passo('(1) a administradora, com o mesmo e-mail de um superadmin, entra pela raiz só com e-mail e senha e cai no BKO em "/"', async () => {
    await pagina.goto(`${BASE}/`);
    await campo(pagina, 'email').waitFor();
    exigir(caminho(pagina) === '/', `a raiz sem sessão saiu para ${caminho(pagina)}`);
    await entrar(pagina, BASE, adm);
    await pagina.getByRole('heading', { name: 'Início' }).waitFor({ timeout: 30_000 });
    exigir(caminho(pagina) === '/', `BKO em ${caminho(pagina)}`);
  });

  await passo('(2) rotas antigas do login: /login, /login?destino=/config e /config/entrar respondem 308 para "/"', async () => {
    for (const c of ['/login', '/login?destino=%2Fconfig', '/config/entrar']) {
      const r = await fetch(`${BASE}${c}`, { redirect: 'manual' });
      const loc = r.headers.get('location') ?? '';
      exigir(r.status === 308 && new URL(loc, BASE).pathname === '/', `${c} -> ${r.status} Location ${loc}`);
    }
  });

  const portal = await novaPagina();
  await passo('(3) /config sem sessão do portal: volta a "/" sem fragmento, com e-mail e senha vazios, sem campo Empresa nem destino', async () => {
    await portal.goto(`${BASE}/config`);
    await portal.waitForURL((u) => new URL(u).pathname === '/');
    const v = await camposDoLogin(portal);
    exigir(v.email === '' && v.senha === '', 'e-mail e senha não vêm preenchidos');
    exigir(v.empresas === 0, 'a tela ainda pede a empresa');
    exigir(v.destinos === 0, 'o formulário ainda tem o campo destino');
    exigir((await portal.evaluate(() => location.hash)) === '', 'o fragmento ficou na barra de endereço');
    await print(portal, '01-config-vai-ao-login.png');
  });

  await passo('(4) o e-mail só de superadmin entra só com e-mail e senha e abre o portal /config, nunca a tela do BKO', async () => {
    await campo(portal, 'email').fill(sa.email);
    await portal.getByLabel('Senha', { exact: true }).fill(sa.senha);
    await portal.getByRole('button', { name: 'Entrar', exact: true }).click();
    await portal.waitForURL((u) => new URL(u).pathname.startsWith('/config'), { timeout: 30_000 });
    await portal.waitForLoadState('networkidle').catch(() => undefined);
    exigir(caminho(portal).startsWith('/config'), `abriu ${caminho(portal)}`);
    exigir((await portal.getByText('Boas-vindas ao Macuxi ERP').count()) === 0, 'abriu a tela do BKO');
    await print(portal, '02-portal-config-aberto.png');
    await portal.context().close();
  });

  await passo('(5) link do e-mail na rota antiga (/login#email=…): cai em "/", com o e-mail preenchido, a senha vazia e o hash limpo', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/login#email=${encodeURIComponent(sa.email)}`);
    const v = await camposDoLogin(p, { email: sa.email });
    exigir(caminho(p) === '/', `o link terminou em ${caminho(p)}`);
    exigir(v.email === sa.email, 'campo E-mail não veio do link');
    exigir(v.senha === '', 'senha preenchida');
    exigir(v.empresas === 0, 'a tela ainda pede a empresa');
    exigir((await p.evaluate(() => location.hash)) === '', 'o hash do link ficou na barra de endereço');
    await print(p, '03-link-email.png');
    await p.context().close();
  });

  await passo('(6) link do e-mail na raiz (/#email=…) com "senha" no hash: e-mail preenchido, senha vazia, hash limpo', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/#email=${encodeURIComponent(adm.email)}&senha=${encodeURIComponent(SENHA_NO_LINK)}`);
    const v = await camposDoLogin(p, { email: adm.email });
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
