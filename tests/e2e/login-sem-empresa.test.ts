/**
 * T-0133 (v0.3.30, ADR 0021): login sem o código da empresa. O e-mail é único entre os usuários de todas as empresas
 * (migração 0079); o superadmin fica fora dessa unicidade (opção A, item 7).
 *
 * Duas partes:
 * 1. Estática: nenhum formulário de acesso tem o campo empresa. São eles a entrada "/" (sem sessão, vai ao /login), o
 *    "Esqueci a senha" (painel do /login), a troca de senha (/senha e /config/senha) e o primeiro acesso (/senha com
 *    `deve_trocar_senha` ou com a temporária). O detector roda contra trechos fictícios e contra as telas reais (a tela
 *    da T-0133 entrou no #919): falha se o campo voltar.
 * 2. As telas com o Playwright, contra o web (next dev) e a API real (`tests/e2e/api-login-config.ts`, Postgres local):
 *    `bash tests/e2e/rodar-login-sem-empresa.sh`. Sem `MACUXI_E2E_BASE` e `MACUXI_E2E_DADOS` (o `pnpm test:tests`), pulam.
 *
 * Só dado fictício; nenhum e-mail em log (LGPD).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENSAGEM_EMPRESA_SUSPENSA, MENSAGEM_ESQUECI_NEUTRA } from '../../packages/platform-sdk/src/index';
import { entrar } from './apoio-e2e.mjs';

const RAIZ = join(__dirname, '../..');

/** Fontes dos formulários de acesso, sem os testes. Pasta ou arquivo, relativos à raiz. */
const FORMULARIOS_DE_ACESSO = [
  'apps/web/src/app/login', // entrada "/" e /login
  'apps/web/src/components/esqueci-senha.tsx', // esqueci a senha
  'apps/web/src/app/senha', // troca de senha e primeiro acesso do BKO
  'apps/web/src/components/formulario-troca-senha.tsx',
  'apps/web/src/app/config/senha', // troca de senha do superadmin (o /config/entrar saiu na v0.3.27: 308 para a raiz)
];

function fontes(caminho: string): string[] {
  const c = join(RAIZ, caminho);
  if (!existsSync(c)) return [];
  if (!statSync(c).isDirectory()) return [c];
  return readdirSync(c, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fontes(join(caminho, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name) ? [join(c, e.name)] : [],
  );
}

/**
 * Sinais de um campo empresa num formulário: `name="empresa"`, um campo montado pelo nome `'empresa'` (lista de campos,
 * `campo('empresa', ...)`, `f.get('empresa')`), o rótulo "Empresa" e o `autoComplete="organization"`. Comentários não contam.
 */
const SINAIS_EMPRESA: readonly RegExp[] = [
  /name\s*=\s*\{?\s*["'`]empresa["'`]/,
  /["'`]empresa["'`]/,
  />\s*Empresa\s*</,
  /(rotulo|label)\s*[:=]\s*\{?\s*["'`]Empresa["'`]/i,
  /autoComplete\s*=\s*\{?\s*["'`]organization["'`]/,
];

/** Linhas (`arquivo:linha: trecho`) com sinal do campo empresa, fora de comentário. */
function camposEmpresa(arquivos: readonly { arquivo: string; texto: string }[]): string[] {
  const r: string[] = [];
  for (const { arquivo, texto } of arquivos)
    texto.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (SINAIS_EMPRESA.some((re) => re.test(l))) r.push(`${arquivo}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  return r;
}

describe('T-0133: nenhum formulário de acesso tem o campo empresa (ADR 0021)', () => {
  it('o detector acha o campo empresa nos jeitos de escrever um formulário', () => {
    const com = [
      '<input name="empresa" />',
      "const CAMPOS = ['empresa', 'email', 'senha'];",
      "{campo('empresa', 'text', 'organization')}",
      "const empresa = String(f.get('empresa') ?? '');",
      '<label htmlFor="x">Empresa</label>',
      "rotulo: 'Empresa',",
      '<input autoComplete="organization" />',
    ];
    expect(com.filter((l) => camposEmpresa([{ arquivo: 'f.tsx', texto: l }]).length === 0)).toEqual([]);
  });

  it('o detector não acusa o formulário só com e-mail e senha, nem comentário nem dado da sessão', () => {
    const texto = [
      "const CAMPOS = ['email', 'senha'];",
      '<input name="email" type="email" autoComplete="username" />',
      '// antes havia o campo empresa (v0.3.29)',
      ' * o campo "empresa" saiu na T-0133',
      '<p>{eu.empresa.razao_social}</p>',
    ].join('\n');
    expect(camposEmpresa([{ arquivo: 'f.tsx', texto }])).toEqual([]);
  });

  it('a lista dos formulários de acesso aponta para fontes que existem', () => {
    const faltam = FORMULARIOS_DE_ACESSO.filter((c) => fontes(c).length === 0);
    expect(faltam).toEqual([]);
  });

  it('entrada "/", esqueci, troca de senha e primeiro acesso: só e-mail e senha', () => {
    const arquivos = FORMULARIOS_DE_ACESSO.flatMap(fontes).map((f) => ({ arquivo: relative(RAIZ, f), texto: readFileSync(f, 'utf8') }));
    expect(arquivos.length).toBeGreaterThan(5);
    expect(camposEmpresa(arquivos)).toEqual([]);
  });
});

/** Web e dados da API do e2e (`rodar-login-sem-empresa.sh`); sem eles, as telas pulam. */
const BASE = process.env.MACUXI_E2E_BASE ?? '';
const DADOS = process.env.MACUXI_E2E_DADOS ?? '';

interface Conta {
  email: string;
  senha: string;
}
interface DadosE2e {
  administrador: Conta;
  superadmin: Conta;
  suspensa: Conta;
}
/** O que o roteiro usa da página do Playwright (o pacote não tem tipos na raiz). */
interface Pagina {
  goto(url: string): Promise<unknown>;
  url(): string;
  waitForURL(f: (u: URL) => boolean, o?: { timeout: number }): Promise<void>;
  setDefaultTimeout(ms: number): void;
  locator(s: string): { count(): Promise<number>; waitFor(o?: { timeout: number }): Promise<void> };
  getByLabel(t: string, o?: { exact: boolean }): { count(): Promise<number>; fill(v: string): Promise<void> };
  getByRole(r: string, o: { name: string; exact?: boolean }): { click(): Promise<void>; waitFor(o?: { timeout: number }): Promise<void> };
  getByText(t: string, o?: { exact: boolean }): { waitFor(o?: { timeout: number }): Promise<void> };
  context(): { close(): Promise<void> };
}
interface Navegador {
  newContext(o: object): Promise<{ newPage(): Promise<Pagina> }>;
  close(): Promise<void>;
}

/**
 * As telas do login sem empresa (ADR 0021), com o Chromium já instalado (`require('playwright')`). Dados fictícios
 * (`@exemplo.invalid`). A API fica em tests/integracao/auth/login-email.db.test.ts e no apps/api/src/login-email.db.test.ts.
 */
describe.runIf(BASE !== '' && DADOS !== '')('T-0133: as telas do login sem empresa (Playwright, API real)', () => {
  let navegador: Navegador;
  let dados: DadosE2e;
  const caminho = (p: Pagina) => new URL(p.url()).pathname;
  const novaPagina = async (): Promise<Pagina> => {
    const ctx = await navegador.newContext({ viewport: { width: 1366, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Manaus' });
    const p = await ctx.newPage();
    p.setDefaultTimeout(90_000); // o next dev compila cada página no primeiro acesso
    return p;
  };
  /** Nenhuma tela de acesso pede a empresa: nem `name="empresa"` nem o rótulo Empresa. */
  const semEmpresa = async (p: Pagina) => {
    await p.locator('form input[name="email"]').waitFor();
    expect((await p.locator('input[name="empresa"]').count()) + (await p.getByLabel('Empresa').count())).toBe(0);
  };

  beforeAll(async () => {
    const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navegador> } };
    navegador = await chromium.launch();
    dados = JSON.parse(readFileSync(DADOS, 'utf8')) as DadosE2e;
  }, 120_000);
  afterAll(async () => {
    await navegador?.close();
  });

  it('usuário de empresa: só e-mail e senha, e a tela abre o BKO', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/`);
    await semEmpresa(p);
    await entrar(p, BASE, dados.administrador);
    await p.getByRole('heading', { name: 'Início' }).waitFor({ timeout: 60_000 });
    expect(caminho(p)).toBe('/');
    await p.context().close();
  }, 180_000);

  it('o e-mail só de superadmin: só e-mail e senha, e a tela abre o /config', async () => {
    const p = await novaPagina();
    await entrar(p, BASE, dados.superadmin);
    await p.waitForURL((u) => u.pathname.startsWith('/config'), { timeout: 60_000 });
    expect(caminho(p).startsWith('/config')).toBe(true);
    await p.context().close();
  }, 180_000);

  it('empresa suspensa, senha certa: a tela mostra a mensagem do SDK e fica no login', async () => {
    const p = await novaPagina();
    await entrar(p, BASE, dados.suspensa);
    await p.getByText(MENSAGEM_EMPRESA_SUSPENSA, { exact: true }).waitFor({ timeout: 60_000 });
    expect(caminho(p)).toBe('/');
    await semEmpresa(p);
    await p.context().close();
  }, 180_000);

  it('"Esqueci a senha" só com o e-mail: a tela mostra a confirmação neutra do SDK', async () => {
    const p = await novaPagina();
    await p.goto(`${BASE}/`);
    await semEmpresa(p);
    await p.getByRole('button', { name: 'Esqueci a senha' }).click();
    expect((await p.locator('input[name="empresa"]').count()) + (await p.getByLabel('Empresa').count())).toBe(0);
    await p.getByLabel('E-mail').fill(`ninguem-e2e-login@exemplo.invalid`);
    await p.getByRole('button', { name: 'Enviar senha temporária' }).click();
    await p.getByText(MENSAGEM_ESQUECI_NEUTRA, { exact: true }).waitFor({ timeout: 60_000 });
    await p.context().close();
  }, 180_000);
});
