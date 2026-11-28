/**
 * T-0133 (v0.3.30, ADR 0021): login sem o código da empresa. O e-mail é único entre os usuários de todas as empresas
 * (migração 0079); o superadmin fica fora dessa unicidade (opção A, item 7).
 *
 * Duas partes:
 * 1. Estática: nenhum formulário de acesso tem o campo empresa. São eles a entrada "/" (sem sessão, vai ao /login), o
 *    "Esqueci a senha" (painel do /login), a troca de senha (/senha e /config/senha) e o primeiro acesso (/senha com
 *    `deve_trocar_senha` ou com a temporária). O detector roda já, contra trechos fictícios; a varredura das telas
 *    liga com `TELA_T0133_ENTROU = true` no PR casado do web (regra 5 da revisão casada), e daí falha se o campo voltar.
 * 2. Roteiro das telas com o Playwright, em `it.todo` até a tela da T-0133 entrar.
 *
 * Só dado fictício; nenhum e-mail em log (LGPD).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '../..');

/**
 * Liga a varredura das telas reais. Fica `false` enquanto o web ainda pede a empresa (v0.3.29); o testes troca para
 * `true` no PR da tela da T-0133, revisado junto com o da API.
 */
const TELA_T0133_ENTROU = false;

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

  it.runIf(TELA_T0133_ENTROU)('entrada "/", esqueci, troca de senha e primeiro acesso: só e-mail e senha', () => {
    const arquivos = FORMULARIOS_DE_ACESSO.flatMap(fontes).map((f) => ({ arquivo: relative(RAIZ, f), texto: readFileSync(f, 'utf8') }));
    expect(arquivos.length).toBeGreaterThan(5);
    expect(camposEmpresa(arquivos)).toEqual([]);
  });
});

/**
 * Roteiro das telas com o Playwright (`tests/e2e/`), em `it.todo` até a tela da T-0133 entrar; a API fica em
 * tests/integracao/auth/login-email.db.test.ts e no apps/api/src/login-email.db.test.ts. Dados fictícios
 * (`@exemplo.invalid`); o `entrar` de `tests/e2e/apoio-e2e.mjs` deixa de preencher a Empresa.
 */
describe('T-0133: roteiro das telas do login sem empresa (Playwright)', () => {
  it.todo('/login só com E-mail e Senha: o usuário de empresa entra e a tela abre o BKO da empresa dele');
  it.todo('/login: o e-mail só de superadmin entra e a tela abre o /config');
  it.todo('/login: a empresa suspensa, com a senha certa, mostra a mensagem MENSAGEM_EMPRESA_SUSPENSA do SDK e não abre sessão');
  it.todo('"Esqueci a senha" só com o E-mail mostra a MENSAGEM_ESQUECI_NEUTRA do SDK');
});
