#!/usr/bin/env node
/**
 * v0.3.26 (R-20261127-172927): aba aberta de um build anterior chama uma Server Action que o servidor novo não conhece.
 * Esperado: o login recarrega UMA vez sozinho (empresa e e-mail voltam, a senha não), e na segunda falha mostra "Há uma versão nova
 * do Macuxi ERP. Recarregue a página." com o botão Recarregar. Nunca "Serviço indisponível".
 *
 * Reprodutível sem segredo: três `next build` do mesmo commit, cada um com uma NEXT_SERVER_ACTIONS_ENCRYPTION_KEY fictícia diferente
 * (a chave muda o id das actions), servidos em standalone na MESMA porta, um de cada vez (A abre a página, B responde ao envio, C à segunda tentativa).
 * Fora do vitest (não é *.test.ts). Playwright já instalado (chromium.launch() sem opções).
 *   pnpm --filter web e2e:versao [--porta 3190] [--prints <pasta>] [--builds <pasta com a/ b/ c/ já prontos>]
 * Sai 0 se tudo passou; 1 se algum passo falhou.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const PORTA = Number(arg('porta', '3190'));
const PRINTS = arg('prints', null);
const BASE = `http://127.0.0.1:${PORTA}`;
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTO = 'Há uma versão nova do Macuxi ERP. Recarregue a página.';
const INDISPONIVEL = 'Serviço indisponível';

const falhas = [];
const confere = (ok, texto) => { console.log(`${ok ? 'ok ' : 'FALHOU'} ${texto}`); if (!ok) falhas.push(texto); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const raiz = arg('builds', null) ?? mkdtempSync(join(tmpdir(), 'mx-e2e-versao-'));
if (!arg('builds', null)) {
  for (const id of ['a', 'b', 'c']) {
    console.log(`build ${id} (chave fictícia própria)…`);
    rmSync(join(WEB, '.next'), { recursive: true, force: true });
    const env = { ...process.env, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: randomBytes(32).toString('base64'), MACUXI_BUILD_ID: `e2e-${id}`, NEXT_TELEMETRY_DISABLED: '1' };
    execFileSync(process.execPath, [join(WEB, 'node_modules/next/dist/bin/next'), 'build'], { cwd: WEB, env, stdio: 'ignore' });
    const destino = join(raiz, id);
    cpSync(join(WEB, '.next/standalone'), destino, { recursive: true });
    cpSync(join(WEB, '.next/static'), join(destino, 'apps/web/.next/static'), { recursive: true });
    if (existsSync(join(WEB, 'public'))) cpSync(join(WEB, 'public'), join(destino, 'apps/web/public'), { recursive: true });
  }
}

let servidor = null;
let logServidor = '';
async function subir(id) {
  await parar();
  servidor = spawn(process.execPath, [join(raiz, id, 'apps/web/server.js')], {
    env: { ...process.env, PORT: String(PORTA), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', MACUXIERP_API_URL: 'http://127.0.0.1:9', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', (d) => { logServidor += d; });
  servidor.stderr.on('data', (d) => { logServidor += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/login`)).ok) return; } catch { /* ainda subindo */ }
    await pausa(200);
  }
  throw new Error(`servidor ${id} não subiu`);
}
async function parar() {
  if (!servidor) return;
  const s = servidor;
  servidor = null;
  s.kill('SIGKILL');
  await new Promise((r) => s.once('exit', r));
  await pausa(300);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' });
  const p = await ctx.newPage();
  let cargas = 0;
  p.on('load', () => { cargas += 1; });
  let viuIndisponivel = false;
  const vigia = setInterval(() => { void p.getByText(INDISPONIVEL).count().then((n) => { if (n > 0) viuIndisponivel = true; }).catch(() => undefined); }, 100);

  // 1. build A: a página abre e fica parada
  await subir('a');
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.getByLabel('Código da empresa').fill('macuxi');
  await p.getByLabel('E-mail').fill('ana@exemplo.com.br');
  await p.getByLabel('Senha', { exact: true }).fill('senha-do-teste-123');
  const cargasAntes = cargas;

  // 1b. cache: o HTML do login e do /config vem com no-store; um estático com hash NÃO
  const cc = async (u) => (await fetch(`${BASE}${u}`)).headers.get('cache-control') ?? '';
  confere((await cc('/login')) === 'no-store', 'HTML do /login com Cache-Control: no-store');
  confere((await cc('/config/entrar')) === 'no-store', 'HTML do /config/entrar com Cache-Control: no-store');
  const html = await (await fetch(`${BASE}/login`)).text();
  const estatico = html.match(/\/_next\/static\/[^"'\s)]+\.js/)?.[0];
  confere(Boolean(estatico), 'achou um /_next/static/*.js no HTML');
  if (estatico) {
    const c = await cc(estatico);
    confere(!c.includes('no-store') && c.includes('immutable'), `estático ${estatico.slice(0, 40)}… sem no-store (cache-control: ${c})`);
  }

  // 2. o servidor passa a ser o build B (outro id de action) e o formulário antigo é enviado
  await subir('b');
  const recarregou = p.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  confere(await recarregou, 'versão nova: a página recarregou sozinha');
  await p.getByLabel('Código da empresa').waitFor();
  await pausa(500);
  confere(cargas === cargasAntes + 1, `recarregou uma vez só (cargas ${cargas - cargasAntes})`);
  confere((await p.getByLabel('Código da empresa').inputValue()) === 'macuxi', 'empresa voltou preenchida');
  confere((await p.getByLabel('E-mail').inputValue()) === 'ana@exemplo.com.br', 'e-mail voltou preenchido');
  confere((await p.getByLabel('Senha', { exact: true }).inputValue()) === '', 'senha NÃO voltou');
  const storage = await p.evaluate(() => JSON.stringify({ s: { ...sessionStorage }, l: { ...localStorage } }));
  confere(!storage.includes('senha-do-teste-123'), 'a senha não está em nenhum storage');
  confere(!(await p.evaluate(() => sessionStorage.getItem('mx.login_rascunho'))), 'rascunho apagado assim que lido');
  confere((await p.getByText(TEXTO).count()) === 0, 'sem aviso na primeira vez (só a recarga)');

  // 3. o servidor passa a ser o build C e o formulário (agora do build B) é enviado: falha de novo com a trava posta
  await subir('c');
  await p.getByLabel('Senha', { exact: true }).fill('senha-do-teste-123');
  const cargasB = cargas;
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.getByText(TEXTO).waitFor({ timeout: 15000 });
  await pausa(800);
  confere(cargas === cargasB, 'segunda falha: não recarrega de novo (sem laço)');
  confere(await p.getByRole('button', { name: 'Recarregar', exact: true }).isVisible(), 'aviso com o botão Recarregar');
  confere(await p.getByRole('button', { name: 'Entrar', exact: true }).isEnabled(), 'o botão Entrar foi solto (não fica "Entrando…")');
  confere(!viuIndisponivel, 'nunca apareceu "Serviço indisponível"');
  confere(!logServidor.includes('ana@exemplo') && !logServidor.includes('senha-do-teste'), 'nenhum dado pessoal no log do servidor');

  if (PRINTS) {
    mkdirSync(PRINTS, { recursive: true });
    await p.screenshot({ path: join(PRINTS, 'aviso-versao-nova-login-1440.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: join(PRINTS, 'aviso-versao-nova-login-390.png') });
    // tela do /config: o mesmo componente do layout raiz, disparado pelo evento que a lib emite na segunda falha
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`${BASE}/config/entrar`, { waitUntil: 'networkidle' });
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('mx:versao-nova')));
      await p.getByText(TEXTO).waitFor();
      await p.screenshot({ path: join(PRINTS, `aviso-versao-nova-config-${w}.png`) });
    }
    await p.setViewportSize({ width: 1440, height: 900 });
  }

  // 3b. layout: o aviso entra no fluxo (não cobre a assinatura); sem aviso nada muda (sem vão)
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    const alvo = p.locator('.cartao-central header').first();
    const sem = await alvo.boundingBox();
    confere((await p.locator('.aviso-versao-nova').count()) === 0, `${w}px: sem aviso não há elemento no DOM (nenhum vão)`);
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('mx:versao-nova')));
    await p.getByText(TEXTO).waitFor();
    const aviso = await p.locator('.aviso-versao-nova').boundingBox();
    const com = await alvo.boundingBox();
    confere(await p.evaluate(() => [...document.body.children].find((e) => e.getClientRects().length > 0)?.classList.contains('aviso-versao-nova') === true), `${w}px: o aviso é o primeiro filho visível do body (o DIV vazio do Next não ocupa espaço)`);
    confere(await p.evaluate(() => getComputedStyle(document.querySelector('.aviso-versao-nova')).position !== 'fixed'), `${w}px: o aviso não é fixed`);
    confere(com.y >= aviso.y + aviso.height - 0.5, `${w}px: topo da assinatura (${com.y.toFixed(1)}) abaixo do fim do aviso (${(aviso.y + aviso.height).toFixed(1)})`);
    confere(Math.abs(com.y - (sem.y + aviso.height)) <= 1, `${w}px: sem aviso a assinatura fica ${aviso.height.toFixed(1)}px mais acima (era ${sem.y.toFixed(1)}, com aviso ${com.y.toFixed(1)})`);
    const g = await p.evaluate(() => { const t = document.querySelector('.aviso-versao-nova-texto').getBoundingClientRect(); const b = document.querySelector('.aviso-versao-nova button').getBoundingClientRect(); return { tf: t.bottom, bt: b.top, tl: t.left, bl: b.left }; });
    confere(g.bt >= g.tf - 0.5, `${w}px: topo do botão (${g.bt.toFixed(1)}) abaixo do fim do texto (${g.tf.toFixed(1)})`);
    confere(Math.abs(g.bl - g.tl) <= 1, `${w}px: botão alinhado à esquerda do texto (${g.bl.toFixed(1)} = ${g.tl.toFixed(1)})`);
  }
  await p.setViewportSize({ width: 1440, height: 900 });

  // 4. o botão recarrega a página
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('mx:versao-nova')));
  const aoRecarregar = p.waitForEvent('load', { timeout: 10000 }).then(() => true, () => false);
  await p.getByRole('button', { name: 'Recarregar', exact: true }).click();
  confere(await aoRecarregar, 'o botão Recarregar recarrega a página');
  clearInterval(vigia);
} catch (e) {
  console.error(e);
  falhas.push(`exceção: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  await parar();
  if (!arg('builds', null)) rmSync(raiz, { recursive: true, force: true });
}
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\ntudo ok');
process.exit(falhas.length ? 1 : 0);
