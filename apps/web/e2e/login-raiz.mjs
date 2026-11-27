#!/usr/bin/env node
/**
 * v0.3.27 (R-20261127-174120, decisão 42 = A): login único na RAIZ.
 * Confere, no `next build` de produção servido em standalone contra uma API falsa local (sem segredo, sem banco):
 *  - "/" sem sessão mostra o login (sem redirect), em 1366 e 390 de largura;
 *  - /login, /login?destino=%2Fconfig e /config/entrar respondem 308 com Location "/";
 *  - o link do e-mail (/login#codigo=…&email=…) cai em "/" e preenche os campos;
 *  - login de empresa de tenant (destino "bko" da API) termina em "/" já no BKO;
 *  - login da empresa MACUXI (destino "config" da API) vai ao /config.
 *   pnpm --filter web e2e:login-raiz [--porta 3191] [--prints <pasta>] [--sem-build]
 * Sai 0 se tudo passou; 1 se algum passo falhou.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const PORTA = Number(arg('porta', '3191'));
const PORTA_API = PORTA + 1;
const PRINTS = arg('prints', null);
const BASE = `http://127.0.0.1:${PORTA}`;
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const falhas = [];
const confere = (ok, texto) => { console.log(`${ok ? 'ok ' : 'FALHOU'} ${texto}`); if (!ok) falhas.push(texto); };

/** API falsa: só o que o login e o BKO pedem. O corpo do login segue o `LoginResposta` do platform-sdk. */
const EU = {
  usuario: { id: '00000000-0000-4000-8000-000000000001', nome: 'Usuária de teste', perfil: 'administrador' },
  empresa: { id: '00000000-0000-4000-8000-0000000000e1', slug: 'demo', razao_social: 'Empresa de Teste Ltda', fuso: 'America/Manaus' },
  filiais: [{ id: '00000000-0000-4000-8000-0000000000f1', nome: 'Matriz', cnpj: '11222333000181' }],
  modulos: [],
};
const api = createServer((req, res) => {
  const json = (s, c, h = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(c)); };
  if (req.url === '/v1/auth/esqueci/situacao') return json(200, { esqueci_disponivel: false });
  if (req.url === '/v1/auth/eu') return json(200, EU);
  if (req.url === '/v1/auth/login' && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const { empresa } = JSON.parse(corpo || '{}');
      const expira_em = new Date(Date.now() + 15 * 60_000).toISOString();
      if (String(empresa).toLowerCase() === 'macuxi') return json(200, { destino: 'config', expira_em }, { 'set-cookie': 'macuxierp_config=tok-config; Path=/; HttpOnly' });
      return json(200, { destino: 'bko', token_acesso: 'tok-acesso', expira_em }, { 'set-cookie': 'macuxierp_refresh=tok-refresh; Path=/; HttpOnly' });
    });
    return;
  }
  return json(401, { codigo: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida.' });
});
await new Promise((r) => api.listen(PORTA_API, '127.0.0.1', r));

if (!process.argv.includes('--sem-build') || !existsSync(join(WEB, '.next/standalone'))) {
  console.log('next build…');
  execFileSync(process.execPath, [join(WEB, 'node_modules/next/dist/bin/next'), 'build'], { cwd: WEB, env: { ...process.env, MACUXI_BUILD_ID: 'e2e-login-raiz', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
}
const SA = join(WEB, '.next/standalone/apps/web');
cpSync(join(WEB, '.next/static'), join(SA, '.next/static'), { recursive: true });
if (existsSync(join(WEB, 'public'))) cpSync(join(WEB, 'public'), join(SA, 'public'), { recursive: true });
const servidor = spawn(process.execPath, [join(SA, 'server.js')], {
  env: { ...process.env, PORT: String(PORTA), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', MACUXIERP_API_URL: `http://127.0.0.1:${PORTA_API}`, NEXT_TELEMETRY_DISABLED: '1' },
  stdio: 'ignore',
});
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* subindo */ }
  await pausa(200);
}

const browser = await chromium.launch();
try {
  const novo = async (largura, altura) => (await browser.newContext({ viewport: { width: largura, height: altura }, locale: 'pt-BR' })).newPage();

  // 1. "/" sem sessão: o login, sem redirect, nos dois tamanhos
  for (const [l, a] of [[1366, 768], [390, 844]]) {
    const p = await novo(l, a);
    const r = await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    confere(r.status() === 200 && new URL(p.url()).pathname === '/', `"/" sem sessão (${l}px): 200 e a URL continua "/"`);
    confere(await p.getByLabel('Código da empresa').isVisible() && await p.getByRole('button', { name: 'Entrar', exact: true }).isVisible(), `"/" sem sessão (${l}px) mostra o login`);
    confere((await p.evaluate(() => document.documentElement.scrollWidth)) <= l, `sem rolagem horizontal em ${l}px`);
    if (PRINTS) { mkdirSync(PRINTS, { recursive: true }); await p.screenshot({ path: join(PRINTS, `raiz-sem-sessao-${l}.png`), fullPage: true }); }
    await p.context().close();
  }

  // 2. rotas antigas: 308 para "/"
  for (const caminho of ['/login', '/login?destino=%2Fconfig', '/config/entrar']) {
    const r = await fetch(`${BASE}${caminho}`, { redirect: 'manual' });
    const loc = r.headers.get('location') ?? '';
    confere(r.status === 308 && new URL(loc, BASE).pathname === '/', `${caminho} -> ${r.status} Location ${loc}`);
  }

  // 3. link do e-mail da temporária: o fragmento sobrevive ao 308 e preenche os campos
  {
    const p = await novo(1366, 768);
    await p.goto(`${BASE}/login#codigo=AM2808&email=ana%40exemplo.com.br`, { waitUntil: 'networkidle' });
    await p.getByLabel('Código da empresa').waitFor();
    await pausa(300);
    confere(new URL(p.url()).pathname === '/', 'link do e-mail termina em "/"');
    confere((await p.getByLabel('Código da empresa').inputValue()) === 'AM2808' && (await p.getByLabel('E-mail').inputValue()) === 'ana@exemplo.com.br', 'link do e-mail preenche empresa e e-mail');
    confere(new URL(p.url()).hash === '', 'o fragmento sai da barra depois de lido');
    await p.context().close();
  }

  // 4. empresa de tenant: destino "bko" -> BKO em "/"
  {
    const p = await novo(1366, 768);
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByLabel('Código da empresa').fill('AM2808');
    await p.getByLabel('E-mail').fill('ana@exemplo.com.br');
    await p.getByLabel('Senha', { exact: true }).fill('senha-do-teste-123');
    await p.getByRole('button', { name: 'Entrar', exact: true }).click();
    await p.getByText('Boas-vindas ao Macuxi ERP').waitFor({ timeout: 15000 });
    confere(new URL(p.url()).pathname === '/', 'login de tenant: BKO em "/"');
    await p.context().close();
  }

  // 5. MACUXI: destino "config" -> /config
  {
    const p = await novo(1366, 768);
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByLabel('Código da empresa').fill('MACUXI');
    await p.getByLabel('E-mail').fill('sa@exemplo.invalid');
    await p.getByLabel('Senha', { exact: true }).fill('senha-do-teste-123');
    const foiAoConfig = p.waitForRequest((r) => new URL(r.url()).pathname === '/config', { timeout: 15000 }).then(() => true, () => false);
    await p.getByRole('button', { name: 'Entrar', exact: true }).click();
    confere(await foiAoConfig, 'login MACUXI: navegou para /config');
    await p.context().close();
  }
} finally {
  await browser.close();
  servidor.kill('SIGKILL');
  api.close();
}
if (falhas.length) { console.log(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log('\ntudo ok');
process.exit(0);
