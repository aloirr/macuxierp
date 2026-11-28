#!/usr/bin/env node
/**
 * v0.3.29 (Config v4, MC-0212): fluxo dos Usuários da Config no navegador, contra uma API FALSA em memória (dados fictícios, sem segredo):
 * criar → senha provisória (uma vez) → redefinir senha → inativar → reativar → excluir, mais o e-mail em uso (409) e o último administrador
 * sem "Excluir". Também gera os prints (deviceScaleFactor 2, 1366 e 390) da aba Empresa, da aba Integrações e do BKO Usuários.
 * A API falsa aplica a RN-CORE-01 e a RN-CORE-17 só para devolver `acoes` e `ultimo_admin_ativo`, como o core; a tela não recalcula.
 * Fora do vitest (não é *.test.ts). Playwright já instalado. Sobe `next dev` na porta pedida.
 *   node e2e/config-usuarios.mjs [--porta 3192] [--api 4012] [--prints <pasta>]
 * Sai 0 se tudo passou; 1 se algum passo falhou.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const PORTA = Number(arg('porta', '3192'));
const PORTA_API = Number(arg('api', '4012'));
const PRINTS = arg('prints', null);
const BASE = `http://127.0.0.1:${PORTA}`;
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMP = '11111111-1111-4111-8111-111111111111';
const falhas = [];
const confere = (ok, texto) => { console.log(`${ok ? 'ok ' : 'FALHOU'} ${texto}`); if (!ok) falhas.push(texto); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- dados fictícios ----
const ID = { ana: '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70', bruno: '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d', carla: '5c6d7e8f-3a41-4c5d-8e9f-2a3b4c5d6e7f', elisa: '9b3c5d7e-2f40-4b6c-8d8e-1f2a3b4c5d6e' };
const SENHA = 'Zq7-provisoria-XYZ99';
const base = (id, nome, perfil, extra = {}) => ({ id, nome, email_mascarado: `${nome.slice(0, 2).toLowerCase()}****@exemplo.com`, perfil, filial_ids: [], situacao: 'ativo', ultimo_acesso_em: '2026-11-27T20:42:00.000Z', deve_trocar_senha: false, ultimo_admin_ativo: false, acoes: [], ...extra });
let usuarios = [];
let novos = 0;
const reiniciar = () => {
  usuarios = [base(ID.ana, 'Ana Exemplo', 'administrador'), base(ID.bruno, 'Bruno Exemplo', 'faturista'), base(ID.carla, 'Carla Exemplo', 'fiscal'), base(ID.elisa, 'Elisa Exemplo', 'fiscal', { situacao: 'inativo', ultimo_acesso_em: '2026-10-02T15:40:00.000Z' })];
  recalcular();
};
function recalcular() {
  const ativos = usuarios.filter((u) => u.perfil === 'administrador' && u.situacao !== 'inativo');
  for (const u of usuarios) {
    u.ultimo_admin_ativo = ativos.length === 1 && ativos[0].id === u.id;
    u.acoes = [...(u.situacao === 'inativo' ? ['editar', 'reativar'] : ['editar', 'redefinir_senha', 'inativar']), ...(u.ultimo_admin_ativo ? [] : ['excluir'])]; // = acoesDoUsuario do domain do core
  }
}
const FICHA = { razao_social: 'EMPRESA EXEMPLO COMÉRCIO LTDA', nome_fantasia: null, ie: null, logradouro: null, numero: null, complemento: null, bairro: 'CENTRO', cep: '69000000', municipio_ibge: '1302603', uf: 'AM', email_mascarado: 'co****@exemplo.com', telefone_mascarado: '(92) ****-0000', cnae_principal: '4781400', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31', data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: ['4751201', '7319002'], receita_fonte: 'fonte-ficticia', receita_consultada_em: '2026-11-27T14:10:00.000Z' };
const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'].map((modulo) => ({ modulo, ativo: modulo !== 'fiscal', valido_ate: null }));
const EMPRESA = { id: EMP, slug: 'exemplo', codigo: 'AM0000', nome: 'EMPRESA EXEMPLO COMÉRCIO LTDA', razao_social: 'EMPRESA EXEMPLO COMÉRCIO LTDA', cnpj: '00000000000100', cidade: 'Manaus', uf: 'AM', fuso: 'America/Manaus', situacao: 'ativo', modulos: MODULOS, primeiro_admin: null, created_at: '2026-11-22T12:41:00.000Z', updated_at: '2026-11-22T12:41:00.000Z', ficha: FICHA };
const ENTIDADES = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco'];
const INTEGRACAO = { empresa_id: EMP, modulo_licenciado: true, credencial_id: EMP, conector_id: 'ent-0000', ambiente: 'producao', chave_prefixo: '91c0abcd', criada_em: '2026-11-23T12:00:00.000Z', entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 500, ultimo_sinal: null, cadastros: ENTIDADES.map((entidade) => ({ entidade, ligada: entidade === 'produto' || entidade === 'cliente', ultimo_envio_em: null, falha: null, lote_em_voo: false })) };
const MONITOR = { identificador: 'ent-0000', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-27T21:58:00.000Z', fila: { lotes: 0, linhas: 0 }, lido_em: '2026-11-27T22:00:00.000Z' };
const ENTRADA = { credenciais: [{ conector_id: 'ENT-0000', prefixo: '7F2AbCdE', criada_em: '2026-11-26T15:00:00.000Z', revogada_em: null }], ultimo_sinal: null, lotes: [{ lote_id: '0a1b2c3d-0000-4000-8000-000000000001', entidade: 'produto', modo: 'delta', status: 'concluido', recebidos: 101, com_erro: 0, recebido_em: '2026-11-27T21:00:00.000Z', concluido_em: '2026-11-27T21:00:05.000Z' }, { lote_id: '0a1b2c3d-0000-4000-8000-000000000002', entidade: 'cliente', modo: 'delta', status: 'concluido_com_erros', recebidos: 60, com_erro: 3, recebido_em: '2026-11-27T20:30:00.000Z', concluido_em: '2026-11-27T20:30:09.000Z' }] };
const CARGA = (numero, cadastro, situacao, erros, quantidade, opcional = false) => ({ numero, cadastro, situacao, erros, ultima_carga: quantidade ? { em: '2026-11-23T18:39:00.000Z', quantidade } : null, liberado: true, opcional });
const CARGAS = { empresa_id: EMP, modulo_licenciado: true, cadastros: [CARGA(1, 'filial', 'carregado', 0, 2), CARGA(2, 'vendedor', 'nao_carregado', 0, 0), CARGA(3, 'condicao_pagamento', 'nao_carregado', 0, 0), CARGA(4, 'produto', 'com_erro', 2, 101), CARGA(5, 'produto_unidade', 'nao_carregado', 0, 0, true), CARGA(6, 'preco', 'nao_carregado', 0, 0), CARGA(7, 'estoque', 'nao_carregado', 0, 0), CARGA(8, 'cliente', 'carregado', 0, 60)] };
const EU = { usuario: { id: '00000000-0000-4000-8000-000000000001', nome: 'Usuária de demonstração', perfil: 'administrador' }, empresa: { id: '00000000-0000-4000-8000-0000000000e1', slug: 'demo', razao_social: 'Empresa de Demonstração Ltda', fuso: 'America/Manaus' }, filiais: [{ id: '00000000-0000-4000-8000-0000000000f1', nome: 'Matriz Manaus', cnpj: '11222333000181' }], modulos: [{ id: 'core', menus: ['Empresa', 'Usuários e perfis'] }] };

// ---- API falsa ----
const usadas = new Set();
const enviar = (res, status, corpo) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(corpo)); };
const erro = (res, status, codigo, mensagem) => enviar(res, status, { codigo, mensagem });
const MSG_ULTIMO = 'A empresa precisa de ao menos um administrador ativo';
const MSG_EMAIL = 'Este e-mail já está em uso em outra empresa. Use outro e-mail.'; // MENSAGEM_EMAIL_EM_USO do SDK (ADR 0021)
const api = createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const caminho = url.pathname;
    const chave = req.headers['idempotency-key'];
    const m = /^\/v1\/plataforma\/empresas\/([^/]+)\/usuarios(?:\/([^/]+)(?:\/(senha|inativar|reativar|excluir))?)?$/.exec(caminho);
    if (caminho === '/v1/auth/eu') return enviar(res, 200, EU);
    if (caminho === '/v1/plataforma/auth/eu') return enviar(res, 200, { superadmin: { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Superadmin Fictício' }, deve_trocar_senha: false, sessao_expira_em: '2026-11-28T04:00:00.000Z' });
    if (caminho.startsWith('/v1/core/usuarios') && req.method === 'GET') return enviar(res, 200, { itens: usuarios.map((u) => ({ id: u.id, nome: u.nome, email: `${u.nome.split(' ')[0].toLowerCase()}@exemplo.com`, perfil: u.perfil, filial_ids: [], ativo: u.situacao !== 'inativo', situacao: u.situacao, external_id: null, ultimo_acesso_em: u.ultimo_acesso_em, updated_at: '2026-11-27T20:00:00.000Z' })), proximo_cursor: null });
    if (m) {
      const [, , id, sub] = m;
      const alvo = id ? usuarios.find((u) => u.id === id) : undefined;
      if (id && !alvo) return erro(res, 404, 'NAO_ENCONTRADO', 'não encontrado');
      if (!id && req.method === 'GET') return enviar(res, 200, { itens: usuarios });
      if (!id && req.method === 'POST') {
        if (!chave || usadas.has(chave)) return erro(res, 409, 'CONFLITO', 'Requisição já concluída');
        usadas.add(chave);
        const c = JSON.parse(corpo || '{}');
        if (c.email === 'ana@exemplo.com') return enviar(res, 409, { codigo: 'CONFLITO', mensagem: MSG_EMAIL, detalhes: { codigo: 'email_em_uso' } });
        novos += 1;
        const u = base(`7d8e9f0a-4b52-4d6e-9f0a-3b4c5d6e7f${String(novos).padStart(2, '0')}`, c.nome, c.perfil, { ultimo_acesso_em: null, deve_trocar_senha: true });
        usuarios.push(u);
        recalcular();
        return enviar(res, 201, { usuario: u, senha_provisoria: SENHA });
      }
      if (req.method === 'PATCH') {
        const e = JSON.parse(corpo || '{}');
        if (e.perfil && e.perfil !== 'administrador' && alvo.ultimo_admin_ativo) return erro(res, 422, 'RN-CORE-01', MSG_ULTIMO);
        Object.assign(alvo, e);
        recalcular();
        return enviar(res, 200, alvo);
      }
      if (sub === 'senha') {
        if (!chave || usadas.has(chave)) return erro(res, 409, 'CONFLITO', 'Requisição já concluída');
        usadas.add(chave);
        return enviar(res, 200, { usuario: alvo, senha_provisoria: SENHA });
      }
      if (sub === 'inativar' || sub === 'excluir') {
        if (alvo.ultimo_admin_ativo) return erro(res, 422, 'RN-CORE-01', MSG_ULTIMO);
        if (sub === 'excluir') { usuarios = usuarios.filter((u) => u.id !== alvo.id); recalcular(); return enviar(res, 200, { id: alvo.id, situacao: 'excluido' }); }
        alvo.situacao = 'inativo';
        recalcular();
        return enviar(res, 200, alvo);
      }
      if (sub === 'reativar') { alvo.situacao = 'ativo'; recalcular(); return enviar(res, 200, alvo); }
    }
    if (caminho === `/v1/plataforma/empresas/${EMP}`) return enviar(res, 200, EMPRESA);
    if (caminho === `/v1/plataforma/empresas/${EMP}/cnpj`) return enviar(res, 200, { permitida: true });
    if (caminho === `/v1/plataforma/empresas/${EMP}/integracao-fdv`) return enviar(res, 200, INTEGRACAO);
    if (caminho === `/v1/plataforma/empresas/${EMP}/integracao-fdv/monitor`) return enviar(res, 200, MONITOR);
    if (caminho === `/v1/plataforma/empresas/${EMP}/entrada`) return enviar(res, 200, ENTRADA);
    if (caminho.startsWith(`/v1/plataforma/empresas/${EMP}/cadastros/cargas`)) return enviar(res, 200, CARGAS);
    return erro(res, 404, 'NAO_ENCONTRADO', 'não encontrado');
  });
});

// ---- servidor web (next dev) ----
let web = null;
let logWeb = '';
async function subirWeb() {
  web = spawn(process.execPath, [join(WEB, 'node_modules/next/dist/bin/next'), 'dev', '--port', String(PORTA), '--hostname', '127.0.0.1'], {
    cwd: WEB,
    env: { ...process.env, MACUXIERP_API_URL: `http://127.0.0.1:${PORTA_API}`, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  web.stdout.on('data', (d) => { logWeb += d; });
  web.stderr.on('data', (d) => { logWeb += d; });
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${BASE}/config/entrar`)).status < 500) return; } catch { /* ainda subindo */ }
    await pausa(300);
  }
  throw new Error(`next dev não subiu\n${logWeb.slice(-800)}`);
}
// o `next dev` cria filhos: mata o grupo todo
const pararWeb = async () => { if (web) { try { process.kill(-web.pid, 'SIGKILL'); } catch { /* já saiu */ } await pausa(300); } };

await new Promise((r) => api.listen(PORTA_API, '127.0.0.1', r));
reiniciar();
if (PRINTS) mkdirSync(PRINTS, { recursive: true });
let browser = null;
try {
  await subirWeb();
  browser = await chromium.launch();
  const contexto = async (largura, altura) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Manaus' });
    await ctx.addCookies([
      { name: 'mx_config', value: 'tok', url: `${BASE}/config` },
      { name: 'mx_acesso', value: 'tok', url: BASE },
      { name: 'mx_refresh', value: 'mx=ref', url: BASE },
    ]);
    return ctx;
  };
  const abrir = async (p, caminho) => { await p.goto(`${BASE}${caminho}`, { waitUntil: 'networkidle', timeout: 120000 }); };
  const linha = (p, nome) => p.locator('tr', { hasText: nome });
  // o clique antes da hidratação não abre o menu: tenta de novo até o menu aparecer
  const menu = async (p, nome) => {
    for (let i = 0; i < 20; i++) {
      await p.getByRole('button', { name: `Ações de ${nome}` }).click();
      if (await p.getByRole('menu').first().isVisible().catch(() => false)) return;
      await pausa(300);
    }
  };
  const item = (p, rotulo) => p.getByRole('menuitem', { name: rotulo, exact: true });
  const aguardarSemDialogo = (p) => p.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 15000 });

  const ctx = await contexto(1366, 900);
  const p = await ctx.newPage();
  const consoleDoNavegador = []; // regra 9: a senha provisória nunca passa pelo console
  p.on('console', (m) => consoleDoNavegador.push(m.text()));
  await abrir(p, `/config/empresas/${EMP}`);
  if ((await p.locator('#h-usuarios').count()) === 0) console.log(`pagina: ${p.url()} :: ${(await p.locator('body').innerText()).slice(0, 600)}`);
  confere((await p.locator('#h-usuarios').count()) === 1, 'a aba Empresa mostra o bloco Usuários');
  confere((await p.getByText('último administrador').count()) === 1, 'a etiqueta "último administrador" aparece uma vez (Ana)');
  await menu(p, 'Ana Exemplo');
  const menuAna = (await p.getByRole('menuitem').allInnerTexts()).join('|');
  confere(menuAna === 'Editar|Redefinir senha|Inativar', `a Ana (${menuAna}) não tem Excluir; o Inativar fica e a API recusa (RN-CORE-01)`);
  await p.keyboard.press('Escape');
  await menu(p, 'Bruno Exemplo');
  const rotulos = await p.getByRole('menuitem').allInnerTexts();
  confere(rotulos.join('|') === 'Editar|Redefinir senha|Inativar|Excluir', `menu do Bruno na ordem de acoes[]: ${rotulos.join(', ')}`);
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'empresa-usuarios-menu-1366.png'), fullPage: false });
  await p.keyboard.press('Escape');
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'empresa-usuarios-1366.png'), fullPage: true });

  // criar → senha provisória uma vez
  await p.getByRole('button', { name: 'Adicionar usuário' }).click();
  await p.getByRole('dialog').getByLabel('Nome', { exact: true }).fill('Diego Exemplo');
  await p.getByRole('dialog').getByLabel('E-mail', { exact: true }).fill('ana@exemplo.com');
  await p.getByRole('button', { name: 'Criar usuário' }).click();
  await p.getByText(MSG_EMAIL).waitFor();
  confere(true, '409 email_em_uso: o texto do SDK no diálogo, que continua aberto');
  await p.getByRole('dialog').locator('input[type="email"]').fill('diego@exemplo.com');
  await p.getByRole('dialog').getByLabel('Perfil').selectOption('vendedor');
  await p.getByRole('button', { name: 'Criar usuário' }).click();
  await p.getByTestId('senha-provisoria').waitFor();
  confere((await p.getByTestId('senha-provisoria').innerText()) === SENHA, 'a senha provisória aparece no diálogo');
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'empresa-usuarios-senha-1366.png') });
  await p.getByRole('button', { name: 'Já entreguei' }).click();
  await aguardarSemDialogo(p);
  await linha(p, 'Diego Exemplo').waitFor();
  confere((await p.getByText(SENHA).count()) === 0, 'depois de fechar, a senha não está mais na página');
  await p.reload({ waitUntil: 'networkidle' });
  const armazenado = await p.evaluate(() => JSON.stringify({ s: { ...sessionStorage }, l: { ...localStorage }, u: location.href }));
  confere(!armazenado.includes(SENHA) && !(await p.content()).includes(SENHA), 'a senha não está em storage, URL nem na página recarregada');
  confere(!consoleDoNavegador.join('\n').includes(SENHA), 'a senha não aparece no console do navegador');

  // redefinir senha → nova senha uma vez
  await menu(p, 'Diego Exemplo');
  await item(p, 'Redefinir senha').click();
  await p.getByRole('button', { name: 'Redefinir senha' }).last().click();
  await p.getByTestId('senha-provisoria').waitFor();
  confere(true, 'redefinir senha mostra a senha provisória de novo');
  await p.getByRole('button', { name: 'Já entreguei' }).click();
  await aguardarSemDialogo(p);

  // inativar → reativar
  await menu(p, 'Diego Exemplo');
  await item(p, 'Inativar').click();
  await p.getByRole('button', { name: 'Inativar' }).last().click();
  await aguardarSemDialogo(p);
  await linha(p, 'Diego Exemplo').getByText('Inativo').waitFor();
  confere(true, 'inativar: a linha passa para "Inativo"');
  await menu(p, 'Diego Exemplo');
  confere((await p.getByRole('menuitem').allInnerTexts()).join('|') === 'Editar|Reativar|Excluir', 'o menu do inativo é Editar, Reativar, Excluir');
  await item(p, 'Reativar').click();
  await p.getByRole('button', { name: 'Reativar' }).last().click();
  await aguardarSemDialogo(p);
  await linha(p, 'Diego Exemplo').getByText('Ativo', { exact: true }).waitFor();
  confere(true, 'reativar: a linha volta a "Ativo"');

  // excluir com confirmação
  await menu(p, 'Diego Exemplo');
  await item(p, 'Excluir').click();
  confere((await p.getByText('Excluir Diego Exemplo?').count()) === 1, 'excluir pede confirmação');
  await p.getByRole('button', { name: 'Excluir' }).last().click();
  await aguardarSemDialogo(p);
  await linha(p, 'Diego Exemplo').waitFor({ state: 'detached' });
  confere(true, 'excluir: a linha sai da tabela');

  // RN-CORE-01: rebaixar o último administrador volta a mensagem do contrato
  await menu(p, 'Ana Exemplo');
  await item(p, 'Editar').click();
  await p.getByRole('dialog').getByLabel('Perfil').selectOption('fiscal');
  await p.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
  await p.getByText(MSG_ULTIMO).waitFor();
  confere(true, '422 RN-CORE-01: a mensagem do contrato aparece');
  await p.keyboard.press('Escape');

  // Integrações e rodapé
  await abrir(p, `/config/empresas/${EMP}?aba=integracao`);
  confere((await p.getByRole('link', { name: 'Integrações' }).count()) === 1 && (await p.getByRole('link', { name: 'Dados' }).count()) === 0, 'duas abas: Empresa e Integrações (sem a aba Dados)');
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'integracoes-1366.png'), fullPage: true });
  await abrir(p, `/config/empresas/${EMP}`);
  const rodape = await p.locator('.rodape-pagina').boundingBox();
  confere(rodape !== null && Math.abs(rodape.y + rodape.height - 900) < 2, 'o rodapé da página fica fixo na base da janela');
  confere((await p.locator('.rodape-pagina').getByRole('button').allInnerTexts()).join('|').includes('Suspender'), 'o rodapé tem "Suspender"');

  // BKO: Inativar e Excluir separados
  reiniciar();
  await abrir(p, '/core/usuarios');
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'bko-usuarios-1366.png'), fullPage: true });
  await linha(p, 'Bruno Exemplo').getByRole('button', { name: /^Ações/ }).last().click();
  const bko = await p.getByRole('menuitem').allInnerTexts();
  confere(bko.join('|') === 'Redefinir senha|Inativar|Excluir', `BKO: Inativar e Excluir separados, Editar à vista, Excluir no fim (${bko.join(', ')})`);
  await p.keyboard.press('Escape');

  // Prints da v0.3.29 (passo 2): 1366 e 1920, página inteira e por bloco, mais o 390
  if (PRINTS) {
    for (const largura of [1366, 1920]) {
      const c = await contexto(largura, 900);
      const q = await c.newPage();
      reiniciar();
      await abrir(q, `/config/empresas/${EMP}`);
      await q.screenshot({ path: join(PRINTS, `empresa-${largura}.png`), fullPage: true });
      await abrir(q, `/config/empresas/${EMP}?aba=integracao`);
      await q.screenshot({ path: join(PRINTS, `integracoes-${largura}.png`), fullPage: true });
      await q.locator('section.ligacao[aria-labelledby="h-ligacao-saida"]').screenshot({ path: join(PRINTS, `ligacao-saida-${largura}.png`) });
      await q.locator('section.ligacao[aria-labelledby="h-ligacao-entrada"]').screenshot({ path: join(PRINTS, `ligacao-entrada-${largura}.png`) });
      await q.locator('.envio-fdv').screenshot({ path: join(PRINTS, `dados-enviados-fdv-${largura}.png`) });
      await abrir(q, '/config/empresas/nova');
      await q.screenshot({ path: join(PRINTS, `empresa-nova-${largura}.png`), fullPage: true });
      await c.close();
    }
  }

  // 390 px
  if (PRINTS) {
    const celular = await contexto(390, 844);
    const m = await celular.newPage();
    reiniciar();
    await abrir(m, `/config/empresas/${EMP}`);
    await m.screenshot({ path: join(PRINTS, 'empresa-390.png'), fullPage: true });
    await abrir(m, `/config/empresas/${EMP}?aba=integracao`);
    await m.screenshot({ path: join(PRINTS, 'integracoes-390.png'), fullPage: true });
    await abrir(m, '/core/usuarios');
    await m.screenshot({ path: join(PRINTS, 'bko-usuarios-390.png'), fullPage: true });
  }
} catch (e) {
  console.log(`FALHOU ${e instanceof Error ? e.message : String(e)}`);
  falhas.push('exceção');
} finally {
  if (browser) await browser.close();
  await pararWeb();
  api.close();
}
if (falhas.length > 0 && process.env.MX_E2E_LOG) console.log(logWeb.slice(-3000));
console.log(falhas.length === 0 ? '\nTudo passou.' : `\n${falhas.length} falha(s).`);
process.exit(falhas.length === 0 ? 0 : 1);
