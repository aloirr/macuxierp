#!/usr/bin/env node
/**
 * v0.3.12 (I-9 e C-5 do docs/testes/plano-v0.3.12.md; regra 3 da T-0065 / X-4): ensaio com as TELAS REAIS (next dev) e a
 * API REAL (`tests/e2e/api-prints-v0312.ts`: plugins de produção, Postgres local, RLS), com prints 1280 e 390 px
 * (deviceScaleFactor 2) só com dados fictícios:
 * - I-9: /config, aba Integração (Monitor, cadastros, Reprocessar, Log, Zerar) e aba Dados; BKO › Integração FDV e Envios;
 * - C-5: BKO › Usuários (lista e senha provisória), Perfis e permissões, Licenças e Auditoria.
 * Cada tela também é conferida contra defeito visível: 404, "Rota não encontrada", erro 5xx, texto técnico (undefined, NaN,
 * [object Object], código de erro cru) e aviso de falha de leitura. Sem Hub: nada sai para o FDV (sem worker de pé).
 *
 * Uso: `bash tests/e2e/rodar-prints-v0312.sh [pasta]` (sobe a API e o next dev), ou à mão:
 *   node tests/e2e/prints-v0312.mjs --base http://localhost:3102 --dados <json da API> --saida <pasta raiz dos prints>
 * Grava em <saida>/I-9 e <saida>/C-5. Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { argumento, criarRoteiro, exigir } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3102');
const SAIDA = argumento('saida', null);
const DADOS = argumento('dados', null);
if (!SAIDA || !DADOS) {
  console.error('uso: node tests/e2e/prints-v0312.mjs --base <url do web> --dados <json do api-prints-v0312.ts> --saida <pasta>');
  process.exit(2);
}
const dados = JSON.parse(readFileSync(DADOS, 'utf8'));
const PASTA = { i9: join(SAIDA, 'I-9'), c5: join(SAIDA, 'C-5') };
for (const p of Object.values(PASTA)) mkdirSync(p, { recursive: true });

const LARGURAS = [
  { nome: '1280', viewport: { width: 1280, height: 800 } },
  { nome: '390', viewport: { width: 390, height: 844 } },
];

/** Texto técnico ou de falha que nunca pode aparecer numa tela com a API real. */
const PROIBIDOS = [/\b404\b/, /Rota não encontrada/i, /NAO_ENCONTRADO/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Internal Server Error/i, /Não foi possível carregar/i, /indisponível agora/i];
async function semDefeitoVisivel(p, onde) {
  const texto = await p.locator('body').innerText();
  for (const r of PROIBIDOS) exigir(!r.test(texto), `${onde}: texto proibido ${r} na tela`);
}

const navegador = await chromium.launch();
const falhas = [];

for (const larg of LARGURAS) {
  const sufixo = `-${larg.nome}.png`;
  const opcoes = { viewport: larg.viewport, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' };
  const r9 = criarRoteiro(PASTA.i9);
  const r5 = criarRoteiro(PASTA.c5);
  const portal = await (await navegador.newContext(opcoes)).newPage();
  const bko = await (await navegador.newContext(opcoes)).newPage();
  portal.setDefaultTimeout(90_000);
  bko.setDefaultTimeout(90_000);
  const base = `${BASE}/config/empresas/${encodeURIComponent(dados.empresa.id)}`;
  /** Menu do BKO: no celular fica atrás do botão; a navegação vai direto pela rota (o menu é conferido no 1280). */
  const irBko = async (rota, titulo) => {
    await bko.goto(`${BASE}${rota}`);
    const h1 = bko.getByRole('heading', { level: 1, name: titulo });
    await h1.waitFor();
    // No 390 o menu do shell vem antes do conteúdo: sem rolar, o print mostra só o menu.
    await h1.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  };
  const topo = (p) => p.evaluate(() => window.scrollTo(0, 0));
  const rolarAte = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'start' }));

  async function entrar(p, empresa, email, senha) {
    await p.goto(`${BASE}/login`);
    await p.getByLabel('Código da empresa').fill(empresa);
    await p.getByLabel('E-mail').fill(email);
    await p.getByLabel('Senha', { exact: true }).fill(senha);
    await p.getByRole('button', { name: 'Entrar' }).click();
  }

  // ------------------------------------------------------------------ I-9: /config
  await r9.passo(`[${larg.nome}] superadmin entra pelo login único e abre a aba Integração da empresa fictícia`, async () => {
    await entrar(portal, 'macuxi', dados.superadmin.email, dados.superadmin.senha);
    await portal.waitForURL((u) => new URL(u).pathname === '/config');
    await portal.goto(`${base}?aba=integracao`);
    await portal.getByRole('heading', { name: 'Monitor' }).waitFor();
    await portal.getByTestId('monitor-indisponivel').waitFor({ state: 'detached', timeout: 1000 }).catch(() => {
      throw new Error('Monitor indisponível com a API real');
    });
    const t = await portal.locator('main').innerText();
    exigir(t.includes('erp-taruma-ficticio'), 'Monitor sem o identificador do conector');
    exigir(/Em dia/i.test(t), 'Monitor sem a situação "Em dia" (último sinal há 1 min)');
    await semDefeitoVisivel(portal, '/config aba Integração');
    await r9.print(portal, `01-integracao-monitor${sufixo}`);
  });

  await r9.passo(`[${larg.nome}] aba Integração: tabela dos cadastros enviados com Reprocessar, Zerar e Log`, async () => {
    await rolarAte(portal.getByRole('heading', { name: 'Cadastros enviados ao FDV' }));
    exigir(await portal.getByRole('button', { name: /^Reprocessar: Produtos/ }).isEnabled(), 'Reprocessar de Produtos desabilitado');
    exigir(await portal.getByRole('button', { name: /^Log: Produtos/ }).isEnabled(), 'Log de Produtos desabilitado');
    exigir(await portal.getByRole('button', { name: /^Zerar: Produtos/ }).isEnabled(), 'Zerar de Produtos desabilitado');
    await r9.print(portal, `02-integracao-cadastros${sufixo}`);
  });

  await r9.passo(`[${larg.nome}] Reprocessar de Produtos: a tela mostra o resultado da API (falhas e pendentes)`, async () => {
    await portal.getByRole('button', { name: /^Reprocessar: Produtos/ }).click();
    const st = portal.getByRole('status').filter({ hasText: /Reprocessar pedido|Nada a reprocessar/ });
    await st.first().waitFor();
    const texto = (await st.first().textContent()) ?? '';
    // 1ª largura: 3 falhas (P-EX-007..009 com erro aberto); 2ª: repetição, o mesmo resultado ou nada novo.
    exigir(/falha|Nada a reprocessar/.test(texto), `resultado do Reprocessar: ${texto}`);
    await rolarAte(st.first());
    await semDefeitoVisivel(portal, '/config Reprocessar');
    await r9.print(portal, `03-reprocessar-produtos${sufixo}`);
  });

  await r9.passo(`[${larg.nome}] Log de Clientes: envios recentes e erros só por código, campo e quantidade (ADR 0013)`, async () => {
    await portal.getByRole('button', { name: /^Log: Clientes/ }).click();
    const d = portal.getByRole('dialog');
    await d.getByRole('heading', { name: /Envios recentes/ }).waitFor();
    const t = await d.innerText();
    exigir(t.includes('Erros abertos: 4'), `total de erros do Log: ${t.slice(0, 200)}`);
    exigir(!/C-EX-01\d\d/.test(t), 'o Log do /config mostra o external_id do registro (ADR 0013)');
    exigir(await d.getByRole('link', { name: 'Abrir no BKO da empresa' }).isVisible(), 'faltou o link ao BKO');
    await semDefeitoVisivel(portal, '/config Log');
    await r9.print(portal, `04-log-clientes${sufixo}`);
    await d.getByRole('button', { name: 'Fechar' }).last().click();
  });

  await r9.passo(`[${larg.nome}] Zerar de Vendedores: aviso e frase de confirmação antes de qualquer efeito (só o diálogo)`, async () => {
    await portal.getByRole('button', { name: /^Zerar: Vendedores/ }).click();
    const d = portal.getByRole('dialog');
    await d.waitFor();
    await d.getByRole('textbox').first().waitFor();
    await semDefeitoVisivel(portal, '/config Zerar');
    await r9.print(portal, `05-zerar-vendedores-dialogo${sufixo}`);
    await d.getByRole('button', { name: /Cancelar|Fechar/ }).first().click();
    await d.waitFor({ state: 'detached' });
  });

  await r9.passo(`[${larg.nome}] aba Dados: última carga CSV de Filiais e Vendedores com data, hora e registros`, async () => {
    await portal.goto(`${base}?aba=dados`);
    await portal.locator('main table').first().waitFor();
    await topo(portal);
    await r9.print(portal, `06-dados${sufixo}`);
    const t = await portal.locator('main').innerText();
    exigir(/Filia/i.test(t) && /Vendedor/i.test(t), 'aba Dados sem os cadastros');
    // No 390 a Última carga e a Origem saem de propósito (globals.css, .tabela-dados): a data só é conferida no 1280.
    if (larg.nome === '1280') exigir(/\d{2}\/\d{2}\/\d{4}/.test(t), `aba Dados sem a data da última carga: ${t.replace(/\s+/g, ' ').slice(0, 400)}`);
    await semDefeitoVisivel(portal, '/config aba Dados');
  });

  // ------------------------------------------------------------------ BKO: administrador da empresa
  await r9.passo(`[${larg.nome}] administrador entra no BKO (escolhe a Matriz) e abre Integração FDV`, async () => {
    const a = dados.administrador;
    await entrar(bko, a.empresa, a.email, a.senha);
    await bko.waitForURL((u) => ['/', '/filial'].includes(new URL(u).pathname));
    if (new URL(bko.url()).pathname === '/filial') {
      await bko.getByLabel(/Matriz Manaus/).check();
      await bko.getByRole('button', { name: /Continuar|Entrar|Selecionar/ }).click();
      await bko.waitForURL((u) => new URL(u).pathname === '/');
    }
    await irBko('/integracao-fdv/integracao-fdv', 'Integração FDV');
    await bko.getByTestId('sinal').waitFor();
    // Print antes da conferência: se a tela tiver defeito, o print fica como prova dele.
    await r9.print(bko, `07-bko-integracao-fdv${sufixo}`);
    await semDefeitoVisivel(bko, 'BKO Integração FDV');
  });

  await r9.passo(`[${larg.nome}] BKO › Envios ao FDV: lotes do Log com situação, registros e com erro`, async () => {
    await irBko('/integracao-fdv/integracao-fdv/lotes', 'Envios ao FDV');
    await bko.locator('main table tbody tr').first().waitFor();
    const n = await bko.locator('main table tbody tr').count();
    exigir(n >= 6, `Envios ao FDV com ${n} linhas (esperado 6 lotes fictícios ou mais)`);
    await semDefeitoVisivel(bko, 'BKO Envios ao FDV');
    await r9.print(bko, `08-bko-envios${sufixo}`);
  });

  // ------------------------------------------------------------------ C-5: telas do core
  await r5.passo(`[${larg.nome}] Usuários: lista com os perfis fictícios`, async () => {
    await irBko('/core/usuarios', 'Usuários');
    await bko.locator('main table tbody tr').first().waitFor();
    const t = await bko.locator('main').innerText();
    for (const nome of ['Administração Tarumã', 'Gerência Comercial Fictícia', 'Expedição Fictícia']) exigir(t.includes(nome), `lista sem ${nome}`);
    await semDefeitoVisivel(bko, 'BKO Usuários');
    await r5.print(bko, `01-usuarios-lista${sufixo}`);
  });

  await r5.passo(`[${larg.nome}] Usuários: Redefinir senha de "${dados.usuarioSenha}" com confirmação mostra a senha provisória uma vez`, async () => {
    await irBko('/core/usuarios', 'Usuários');
    await bko.getByRole('row').filter({ hasText: dados.usuarioSenha }).getByRole('button', { name: 'Redefinir senha' }).click();
    const conf = bko.getByRole('dialog');
    await conf.waitFor();
    await conf.getByRole('button', { name: /Redefinir|Confirmar/ }).last().click();
    const painel = bko.locator('[data-segredo]');
    await painel.waitFor();
    exigir(((await painel.textContent()) ?? '').trim().length >= 8, 'senha provisória vazia ou curta');
    await semDefeitoVisivel(bko, 'BKO senha provisória');
    await r5.print(bko, `02-usuarios-senha-provisoria${sufixo}`);
  });

  await r5.passo(`[${larg.nome}] Perfis e permissões`, async () => {
    await irBko('/core/perfis', 'Perfis e permissões');
    await bko.getByText(/Administrador/).first().waitFor();
    await semDefeitoVisivel(bko, 'BKO Perfis e permissões');
    await r5.print(bko, `03-perfis-permissoes${sufixo}`);
  });

  await r5.passo(`[${larg.nome}] Licenças: os seis módulos licenciados, só leitura`, async () => {
    await irBko('/core/licencas', 'Licenças');
    await bko.locator('main table tbody tr').first().waitFor();
    const n = await bko.locator('main table tbody tr').count();
    exigir(n >= 6, `Licenças com ${n} linhas (esperado 6)`);
    await semDefeitoVisivel(bko, 'BKO Licenças');
    await r5.print(bko, `04-licencas${sufixo}`);
  });

  await r5.passo(`[${larg.nome}] Auditoria: criação, senha redefinida e inativação de usuário, carga e reprocessar`, async () => {
    await irBko('/core/auditoria', 'Auditoria');
    await bko.locator('main table tbody tr').first().waitFor();
    const n = await bko.locator('main table tbody tr').count();
    exigir(n >= 4, `Auditoria com ${n} linhas`);
    await semDefeitoVisivel(bko, 'BKO Auditoria');
    await r5.print(bko, `05-auditoria${sufixo}`);
  });

  for (const [caso, r] of [['I-9', r9], ['C-5', r5]]) {
    for (const x of r.resultados) if (!x.ok) falhas.push(`${caso} ${x.nome}: ${x.erro}`);
    console.error(`[prints] ${caso} ${larg.nome}: ${r.prints.length} prints`);
  }
  await portal.context().close();
  await bko.context().close();
}
await navegador.close();

if (falhas.length) {
  console.error(`\n[prints] ${falhas.length} passo(s) com falha:`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}
console.error('[prints] todos os passos passaram');
