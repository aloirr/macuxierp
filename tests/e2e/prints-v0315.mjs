#!/usr/bin/env node
/**
 * v0.3.15 (T-0101 R-3, T-0093 e a frase em fonte mono do #685/#681): prints 1280 e 390 px (deviceScaleFactor 2) do /config
 * com as TELAS REAIS e a API REAL (`tests/e2e/api-prints-v0315.ts`), só com dados fictícios:
 * - aba Empresa: com ficha, sem ficha e consultada sem dados;
 * - aba Integração: Zerar por cadastro (Vendedores) e Zerar pedidos não faturados (N > 0 e N = 0);
 * - aba Dados: Substituir tudo (Filiais), até a janela da frase, sem gravar.
 * Nenhuma ação destrutiva é confirmada: cada diálogo é fotografado e cancelado. Cada tela é conferida contra defeito
 * visível (404, texto técnico, falha de leitura, rolagem horizontal) e a frase de confirmação tem de estar em fonte mono.
 *
 * Uso: `bash tests/e2e/rodar-prints.sh v0315 docs/testes/prints/v0.3.15`, ou à mão:
 *   node tests/e2e/prints-v0315.mjs --base http://localhost:3103 --dados <json da API> --saida <pasta>
 * Sai 0 se todos os passos passaram; 1 se algum falhou (lista no fim).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argumento, criarRoteiro, entrar, exigir, LARGURAS_PRINT, semDefeitoVisivel } from './apoio-e2e.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = argumento('base', 'http://localhost:3103');
const SAIDA = argumento('saida', null);
const DADOS = argumento('dados', null);
if (!SAIDA || !DADOS) {
  console.error('uso: node tests/e2e/prints-v0315.mjs --base <url do web> --dados <json do api-prints-v0315.ts> --saida <pasta>');
  process.exit(2);
}
mkdirSync(SAIDA, { recursive: true });
const dados = JSON.parse(readFileSync(DADOS, 'utf8'));

/** A frase de confirmação do diálogo tem de estar em fonte mono (marca, #685). */
async function fraseEmMono(d, onde) {
  const fonte = await d.locator('.frase-confirmar').first().evaluate((el) => getComputedStyle(el).fontFamily);
  exigir(/mono|courier|consolas|menlo/i.test(fonte), `${onde}: frase sem fonte mono (${fonte})`);
}

const navegador = await chromium.launch();
const r = criarRoteiro(SAIDA);

for (const larg of LARGURAS_PRINT) {
  const sufixo = `-${larg.nome}.png`;
  const p = await (await navegador.newContext({ viewport: larg.viewport, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' })).newPage();
  p.setDefaultTimeout(90_000);
  const empresa = (id) => `${BASE}/config/empresas/${encodeURIComponent(id)}`;
  const rolarAte = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const dialogo = () => p.getByRole('dialog').last();
  /** Clique que só vale depois da hidratação do next dev: repete até o efeito esperado aparecer. */
  const clicarAte = async (alvo, pronto) => {
    for (let i = 0; i < 20; i++) {
      // Rola antes: a rolagem que o Playwright faz no clique chega depois dele e fecha o menu "Ações" (regra 6, menu-acoes.mjs).
      await alvo.scrollIntoViewIfNeeded();
      await p.waitForTimeout(150);
      await alvo.click();
      if (await pronto().catch(() => false)) return;
      await p.waitForTimeout(500);
    }
    throw new Error('o clique não surtiu efeito (tela sem hidratar?)');
  };
  const cancelar = async () => {
    const d = dialogo();
    await d.getByRole('button', { name: /Cancelar|Fechar/ }).first().click();
    await d.waitFor({ state: 'detached' });
  };

  await r.passo(`[${larg.nome}] superadmin entra no /config`, async () => {
    await entrar(p, BASE, { empresa: 'macuxi', email: dados.superadmin.email, senha: dados.superadmin.senha });
    await p.waitForURL((u) => new URL(u).pathname === '/config');
  });

  for (const [caso, id, espera] of [
    ['empresa-com-ficha', dados.empresas.comFicha, /Mostrar/],
    ['empresa-sem-ficha', dados.empresas.semFicha, /Ainda não consultada/],
    ['empresa-consultada-sem-dados', dados.empresas.consultada, /Sem dados na Receita\./],
  ]) {
    await r.passo(`[${larg.nome}] aba Empresa: ${caso}`, async () => {
      await p.goto(empresa(id));
      const h = p.getByRole('heading', { name: 'Ficha da Receita' });
      await h.waitFor();
      const t = await p.locator('main').innerText();
      exigir(espera.test(t), `${caso}: faltou ${espera}`);
      if (caso === 'empresa-com-ficha') {
        exigir(!t.includes('contato@exemplo.invalid'), 'e-mail aparece inteiro sem o Mostrar');
        exigir(!/Revelar/.test(t), 'o botão do dado mascarado ainda diz "Revelar" (decisão 9 A, #697: "Mostrar")');
        exigir(/Manaus/.test(t) && /\bAM\b/.test(t), 'cidade e UF da ficha não aparecem');
      }
      await semDefeitoVisivel(p, caso);
      if (larg.nome === '390') await rolarAte(h);
      await r.print(p, `${caso}${sufixo}`);
    });
  }

  await r.passo(`[${larg.nome}] Zerar por cadastro (Vendedores): diálogo com a frase em mono, cancelado`, async () => {
    await p.goto(`${empresa(dados.empresas.comFicha)}?aba=integracao`);
    const g = p.getByRole('button', { name: 'Ações de Vendedores', exact: true });
    await clicarAte(g, async () => (await g.getAttribute('aria-expanded')) === 'true');
    await p.getByRole('menuitem', { name: 'Zerar', exact: true }).click();
    const d = dialogo();
    await d.getByRole('textbox').first().waitFor();
    // O aviso dos 30% só aparece com a prévia carregada: sem esperar, o print de 1280 saía sem ele (designer, 25/11).
    await d.getByTestId('aviso-30-fdv').waitFor();
    await fraseEmMono(d, 'Zerar por cadastro');
    await semDefeitoVisivel(p, 'Zerar por cadastro');
    await r.print(p, `zerar-cadastro${sufixo}`);
    await cancelar();
  });

  for (const [caso, id, n] of [
    ['zerar-pedidos-n-maior-0', dados.empresas.comFicha, 3],
    ['zerar-pedidos-n-0', dados.empresas.semFicha, 0],
  ]) {
    await r.passo(`[${larg.nome}] Zerar pedidos não faturados: ${caso}`, async () => {
      await p.goto(`${empresa(id)}?aba=integracao`);
      await clicarAte(p.getByRole('button', { name: 'Zerar pedidos não faturados' }), () => p.getByRole('dialog').isVisible());
      const d = dialogo();
      await d.waitFor();
      if (n > 0) {
        await d.getByRole('textbox').first().waitFor();
        await d.getByTestId('apagar-pedidos').waitFor();
        const t = await d.innerText();
        exigir(t.includes(String(n)), `prévia sem os ${n} pedidos: ${t.slice(0, 200)}`);
        await fraseEmMono(d, caso);
      } else {
        await d.getByText(/Não há pedidos/).waitFor();
        exigir((await d.getByRole('textbox').count()) === 0, 'N = 0 com campo da frase');
      }
      await semDefeitoVisivel(p, caso);
      await r.print(p, `${caso}${sufixo}`);
      await cancelar();
    });
  }

  await r.passo(`[${larg.nome}] Substituir tudo (Filiais): janela da frase em mono, cancelada sem gravar`, async () => {
    await p.goto(`${empresa(dados.empresas.comFicha)}?aba=dados`);
    const linha = p.getByRole('row').filter({ hasText: 'Filiais' });
    await clicarAte(linha.getByRole('button', { name: /Importar/ }).first(), () => p.getByRole('dialog').isVisible());
    const imp = dialogo();
    await imp.locator('input[type="file"]').setInputFiles(dados.csvFilial);
    const botao = imp.getByRole('button', { name: 'Substituir tudo' });
    await p.waitForFunction((el) => !el.disabled, await botao.elementHandle());
    await botao.click();
    const d = p.getByRole('dialog').filter({ hasText: /Substituir tudo em/ });
    await d.getByRole('textbox').first().waitFor();
    await fraseEmMono(d, 'Substituir tudo');
    await semDefeitoVisivel(p, 'Substituir tudo');
    await r.print(p, `substituir-tudo${sufixo}`);
    // Aqui não serve o cancelar(): a janela da frase não é o último diálogo do DOM (a do Importar segue aberta).
    await d.getByRole('button', { name: /Cancelar|Fechar/ }).first().click();
  });

  await p.context().close();
}
await navegador.close();

const falhas = r.resultados.filter((x) => !x.ok).map((x) => `${x.nome}: ${x.erro}`);
console.error(`[prints] ${r.prints.length} prints em ${SAIDA}`);
if (falhas.length) {
  console.error(`\n[prints] ${falhas.length} passo(s) com falha:`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}
