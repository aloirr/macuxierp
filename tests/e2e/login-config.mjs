#!/usr/bin/env node
/**
 * R-20261127-061730 (v0.3.20, prioridade crítica do Alexandre): e2e do login único entre o BKO e o portal /config, com as
 * telas reais (next dev) e a API real (`tests/e2e/api-login-config.ts`, Postgres local). Só dado fictício, nunca a rede.
 *
 * O defeito: quem entrou no BKO com o código de uma empresa e abre /config cai no /login sem destino, com o campo Empresa
 * preenchido pelo último código salvo (`lib/codigo-salvo.ts`); o Entrar leva ao BKO, não ao portal. O esperado:
 * - /config sem sessão do portal → /login com o destino /config e o campo Empresa = MACUXI (`CODIGO_SUPERADMIN_LOGIN`);
 * - o Entrar, sem mexer na Empresa, abre o /config e nunca a tela do BKO;
 * - o link do e-mail `/login#codigo=…&email=…` preenche os dois campos (acima do código salvo) e limpa o hash;
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
/** Valores dos campos depois do efeito de montagem do formulário (código salvo ou hash do link); `emailEsperado` espera o do link. */
async function camposDoLogin(p, emailEsperado) {
  await campo(p, 'email').waitFor();
  const pronto = ([e]) => document.querySelector('form input[name="empresa"]')?.value && (!e || document.querySelector('form input[name="email"]')?.value === e);
  await p.waitForFunction(pronto, [emailEsperado], { timeout: 10_000 }).catch(() => undefined);
  return {
    empresa: await campo(p, 'empresa').inputValue(),
    email: await campo(p, 'email').inputValue(),
    senha: await p.getByLabel('Senha', { exact: true }).inputValue(),
    destino: await campo(p, 'destino').inputValue(),
  };
}

let pagina;
try {
  pagina = await novaPagina();

  await passo('(1) a pessoa entra no BKO com o código da empresa fictícia; o login guarda esse código', async () => {
    await entrar(pagina, BASE, adm);
    await pagina.waitForURL((u) => new URL(u).pathname === '/');
    const salvo = await pagina.evaluate((k) => localStorage.getItem(k), CHAVE_CODIGO);
    exigir(salvo === CODIGO_EMPRESA, `código salvo: ${salvo}`);
  });

  await passo('(2) abre /config sem sessão do portal: /login com o destino /config e a Empresa = MACUXI, nunca o BKO', async () => {
    await pagina.goto(`${BASE}/config`);
    await pagina.waitForURL((u) => new URL(u).pathname === '/login');
    const url = new URL(pagina.url());
    exigir((url.searchParams.get('destino') ?? '').startsWith('/config'), `destino na URL: ${url.searchParams.get('destino')}`);
    const v = await camposDoLogin(pagina);
    exigir(v.destino.startsWith('/config'), `destino do formulário: ${v.destino}`);
    exigir(v.empresa === sa.empresa, `campo Empresa: ${v.empresa} (esperado ${sa.empresa})`);
    exigir(v.email === '' && v.senha === '', 'e-mail e senha não vêm preenchidos');
    await print(pagina, '01-config-vai-ao-login-macuxi.png');
  });

  await passo('(3) Entrar sem mexer na Empresa abre o portal /config, nunca a tela do BKO', async () => {
    await campo(pagina, 'email').fill(sa.email);
    await pagina.getByLabel('Senha', { exact: true }).fill(sa.senha);
    await pagina.getByRole('button', { name: 'Entrar' }).click();
    await pagina.waitForURL((u) => new URL(u).pathname !== '/login', { timeout: 30_000 });
    exigir(new URL(pagina.url()).pathname.startsWith('/config'), `abriu ${new URL(pagina.url()).pathname}`);
    const salvo = await pagina.evaluate((k) => localStorage.getItem(k), CHAVE_CODIGO);
    exigir(salvo === CODIGO_EMPRESA, `o login do portal não troca o código salvo da empresa: ${salvo}`);
    await print(pagina, '02-portal-config-aberto.png');
  });

  await passo('(4) link do e-mail do superadmin, com o código da empresa salvo: Empresa = MACUXI e o e-mail preenchidos, hash limpo', async () => {
    const p = await novaPagina(CODIGO_EMPRESA);
    await p.goto(`${BASE}/login#codigo=${encodeURIComponent(sa.empresa)}&email=${encodeURIComponent(sa.email)}`);
    const v = await camposDoLogin(p, sa.email);
    exigir(v.empresa === sa.empresa, `campo Empresa: ${v.empresa} (esperado ${sa.empresa})`);
    exigir(v.email === sa.email, 'campo E-mail não veio do link');
    exigir(v.senha === '', 'senha preenchida');
    const hash = await p.evaluate(() => location.hash);
    exigir(hash === '', 'o hash do link ficou na barra de endereço');
    await print(p, '03-link-email-superadmin.png');
    await p.context().close();
  });

  await passo('(5) link do e-mail da empresa com "senha" no hash: código e e-mail preenchidos, senha vazia, hash limpo', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/login#codigo=${encodeURIComponent(adm.empresa)}&email=${encodeURIComponent(adm.email)}&senha=${encodeURIComponent(SENHA_NO_LINK)}`);
    const v = await camposDoLogin(p, adm.email);
    exigir(v.empresa === CODIGO_EMPRESA, `campo Empresa: ${v.empresa} (esperado ${CODIGO_EMPRESA})`);
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
