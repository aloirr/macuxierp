#!/usr/bin/env node
/**
 * T-0021: em 1024 px o botão "Emitir nota" da lista de pedidos a faturar fica visível sem rolar, e as demais listas não cortam coluna.
 * Fora do vitest (não é *.test.ts): usa o Playwright instalado globalmente (sem `playwright install`).
 * Uso: shell no ar com uma API (real ou dublê) e o perfil de administrador na sessão:
 *   node apps/web/e2e/tabelas-1024.mjs --base http://localhost:3100 [--saida <pasta dos prints>]
 * Cookies de sessão fictícios (`mx_acesso`, `mx_refresh`) são os do dublê; com API real, entre pelo login e passe o cookie de acesso na variável de ambiente MACUXI_E2E_COOKIE (nunca como argumento).
 * Sai 0 se tudo passou; 1 se algum passo falhou.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const BASE = arg('base', 'http://localhost:3100');
const SAIDA = arg('saida', null);
if (SAIDA) mkdirSync(SAIDA, { recursive: true });

const falhas = [];
const confere = (ok, texto) => { console.log(`${ok ? 'ok ' : 'FALHOU'} ${texto}`); if (!ok) falhas.push(texto); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' });
await ctx.addCookies([{ name: 'mx_acesso', value: process.env.MACUXI_E2E_COOKIE ?? 'adm', url: BASE, httpOnly: true }, { name: 'mx_refresh', value: 'mx=r1', url: BASE, httpOnly: true }]);
const p = await ctx.newPage();
const print = (n, cheio = true) => (SAIDA ? p.screenshot({ path: `${SAIDA}/${n}.png`, fullPage: cheio }) : Promise.resolve());

await p.goto(`${BASE}/faturamento/pedidos-a-faturar`, { waitUntil: 'networkidle' });
const botoes = p.getByRole('button', { name: 'Emitir nota', exact: true });
confere((await botoes.count()) > 0, 'a lista tem botões "Emitir nota"');
for (let i = 0; i < (await botoes.count()); i++) {
  const b = await botoes.nth(i).boundingBox();
  const rolavel = await p.locator('.tabela-rolavel').boundingBox();
  const visivel = b !== null && rolavel !== null && b.x >= rolavel.x && b.x + b.width <= rolavel.x + rolavel.width + 0.5 && b.x + b.width <= 1024;
  confere(visivel, `em 1024 px, "Emitir nota" #${i + 1} fica dentro da área visível sem rolar (x=${b?.x.toFixed(0)}, largura=${b?.width.toFixed(0)}, borda direita da tabela=${rolavel ? (rolavel.x + rolavel.width).toFixed(0) : '?'})`);
}
await print('pedidos-a-faturar-1024');

for (const rota of ['notas', 'rejeicoes', 'titulos', 'pedidos-a-faturar']) {
  await p.goto(`${BASE}/faturamento/${rota}`, { waitUntil: 'networkidle' });
  const m = await p.evaluate(() => { const e = document.querySelector('.tabela-rolavel'); return e ? { rolagem: e.scrollWidth, area: e.clientWidth, ultima: (() => { const th = e.querySelectorAll('thead th'); const r = th[th.length - 1].getBoundingClientRect(); return r.right; })(), borda: e.getBoundingClientRect().right } : null; });
  console.log(rota, JSON.stringify(m));
  confere(m !== null && m.ultima <= m.borda + 0.5, `${rota}: a última coluna cabe na área visível, sem rolar (borda direita ${m?.ultima.toFixed(0)} de ${m?.borda.toFixed(0)}; rolagem ${m?.rolagem} para área ${m?.area})`);
}

await browser.close();
if (falhas.length) { console.error(`${falhas.length} passo(s) falharam.`); process.exit(1); }
