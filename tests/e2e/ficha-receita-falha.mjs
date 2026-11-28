#!/usr/bin/env node
/**
 * T-0101, R-2 do plano da v0.3.13 (e2e da tela): /config › empresa › aba Empresa › "Atualizar" (pela Receita), com a fonte
 * dublada (`tests/e2e/api-ficha-receita.ts`). Em 1280 e 390 (dsf 2), para cada falha da fonte (tempo esgotado, 404, 503,
 * 200 fora do formato): a tela mostra a mensagem do catálogo no lugar (role=alert), nunca "Algo deu errado", o CNPJ nem o
 * corpo da fonte, e a ficha na tela não muda depois de recarregar. O caso ok (fluxo da v0.3.24, #853): a consulta é uma prévia
 * ("A Receita trouxe dados diferentes. Confira e clique em Salvar."); o Salvar grava ("Ficha salva. Mudou: …"); consultar de
 * novo diz "A Receita trouxe os mesmos dados da ficha salva.".
 * Gravação no banco e log: `tests/integracao/plataforma/empresa-ficha.db.test.ts` (R-2 e R-5).
 * Uso: `bash tests/e2e/rodar-ficha-receita.sh [pasta dos prints]`. Sai 0 se todos os passos passaram.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { abrirNavegador, argumento, criarRoteiro, entrar, exigir, LARGURAS_PRINT, novoContexto } from './apoio-e2e.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = argumento('base', 'http://localhost:3103');
const SAIDA = argumento('saida', null);
const dados = JSON.parse(readFileSync(argumento('dados', null), 'utf8'));
mkdirSync(SAIDA, { recursive: true });

/** Mensagem esperada por caso (catálogo `mensagemDaFalhaReceita` do core). */
const ESPERADA = {
  tempo: /Não foi possível consultar a Receita agora/,
  erro_5xx: /Não foi possível consultar a Receita agora/,
  nao_encontrado: /A Receita não encontrou o CNPJ desta empresa/,
  fora_do_formato: /A Receita devolveu dados incompletos/,
};
const cnpjFormatado = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const PROIBIDOS = [/Algo deu errado/i, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Internal Server Error/i, /TimeoutError|aborted/i];

const nav = await abrirNavegador(chromium);
const r = criarRoteiro(SAIDA);
for (const { nome: larg, viewport } of LARGURAS_PRINT) {
  const p = await (await novoContexto(nav, { viewport, deviceScaleFactor: 2 })).newPage();
  p.setDefaultTimeout(60_000);
  await r.passo(`[${larg}] superadmin entra no /config`, async () => {
    await entrar(p, BASE, dados.superadmin);
    await p.waitForURL(/\/config/);
  });
  const titulo = p.getByRole('heading', { name: 'Ficha da Receita' });
  const ficha = () => p.locator('section, div').filter({ has: titulo }).last();
  const atualizar = async (caso) => {
    await p.goto(`${BASE}/config/empresas/${dados.empresas[caso]}`);
    await titulo.waitFor();
    const antes = await ficha().innerText();
    await p.getByRole('button', { name: 'Atualizar', exact: true }).click();
    const aviso = p.locator('[role="alert"], [role="status"]').filter({ hasText: /Receita|Ficha|Consulta/ }).first();
    await aviso.waitFor();
    await aviso.scrollIntoViewIfNeeded();
    return { antes, aviso };
  };
  for (const caso of Object.keys(ESPERADA)) {
    await r.passo(`[${larg}] ${caso}: mensagem do catálogo no lugar, sem CNPJ nem corpo da fonte, e a ficha não muda`, async () => {
      const { antes, aviso } = await atualizar(caso);
      exigir((await aviso.getAttribute('role')) === 'alert', `${caso}: a falha não saiu como alerta`);
      const texto = await aviso.innerText();
      exigir(ESPERADA[caso].test(texto), `${caso}: mensagem fora do catálogo: ${texto}`);
      await r.print(p, `falha-${caso}-${larg}.png`);
      const tela = await p.locator('body').innerText();
      for (const x of PROIBIDOS) exigir(!x.test(tela), `${caso}: texto proibido ${x}`);
      const cnpj = dados.cnpjs[caso];
      exigir(!texto.includes(cnpj) && !texto.includes(cnpjFormatado(cnpj)), `${caso}: a mensagem leva o CNPJ`);
      exigir(!tela.includes(dados.marcaDoCorpo), `${caso}: a tela mostra o corpo da fonte`);
      await p.reload();
      await titulo.waitFor();
      exigir((await ficha().innerText()) === antes, `${caso}: a ficha mudou depois da falha`);
    });
  }
  // 1280: a prévia traz dados diferentes e o Salvar grava; 390 consulta de novo a mesma empresa e a prévia diz que nada mudou
  const esperadaOk = larg === '1280' ? 'A Receita trouxe dados diferentes. Confira e clique em Salvar.' : 'A Receita trouxe os mesmos dados da ficha salva.';
  await r.passo(`[${larg}] ok: a prévia diz "${esperadaOk}"${larg === '1280' ? ' e o Salvar grava ("Ficha salva.")' : ''}`, async () => {
    const { aviso } = await atualizar('ok');
    exigir((await aviso.getAttribute('role')) === 'status', 'ok: a prévia saiu como alerta');
    exigir((await aviso.innerText()).includes(esperadaOk), `ok: ${await aviso.innerText()}`);
    if (larg === '1280') {
      await p.getByRole('button', { name: 'Salvar', exact: true }).click();
      const salvo = p.locator('[role="status"]').filter({ hasText: /Ficha salva\. Mudou:/ }).first();
      await salvo.waitFor();
      await salvo.scrollIntoViewIfNeeded();
    }
    await r.print(p, `ok-${larg}.png`);
  });
}
await nav.close();
const falhas = r.resultados.filter((x) => !x.ok);
for (const f of falhas) console.error(`FALHA: ${f.nome}: ${f.erro}`);
console.error(`[e2e] ${r.resultados.length - falhas.length}/${r.resultados.length} passos ok; prints: ${r.prints.length}`);
process.exit(falhas.length ? 1 : 0);
