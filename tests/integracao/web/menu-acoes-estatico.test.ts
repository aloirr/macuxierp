/**
 * T-0099, A-6 do plano da v0.3.13 (estático): o botão "Ações" das linhas é um componente só, o `MenuAcoes` de
 * `packages/ui` (regras 1 e 8 de docs/marca/botao-acoes.md; R-20261124-224843). Lê o código-fonte de `apps/web/src` e
 * `modules/<m>/web`, sem executar: nenhum "⋯" (U+22EF) nem "…"/"..." sozinho como rótulo de botão, nenhum menu próprio
 * (`role="menu"`, `aria-haspopup="menu"`, `role="menuitem"`) e nenhuma cópia local do componente. A fileira de botões
 * na linha e o comportamento (teclado, Esc, clique fora, rolagem, 44 px) ficam no e2e `tests/e2e/menu-acoes.mjs`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '../../..');

function fontes(dir: string): string[] {
  const r: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const c = join(dir, e.name);
    if (e.isDirectory()) r.push(...fontes(c));
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) r.push(c);
  }
  return r;
}

const MODULOS = readdirSync(join(RAIZ, 'modules'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(RAIZ, 'modules', d.name, 'web'))
  .filter((d) => existsSync(d));
const TELAS = [join(RAIZ, 'apps/web/src'), ...MODULOS].flatMap(fontes).map((f) => ({ arquivo: relative(RAIZ, f), texto: readFileSync(f, 'utf8') }));

/** Linhas (arquivo:linha: trecho) em que `re` casa, fora de comentário de linha. */
function achados(re: RegExp, arquivos = TELAS): string[] {
  const r: string[] = [];
  for (const { arquivo, texto } of arquivos)
    texto.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (re.test(l)) r.push(`${arquivo}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  return r;
}

describe('T-0099 A-6: botão "Ações" único, sem "⋯" nas telas (estático)', () => {
  it('lê as telas do shell e de módulos com web (a varredura não está vazia)', () => {
    expect(TELAS.length).toBeGreaterThan(20);
    expect(MODULOS.length).toBeGreaterThan(0);
  });

  it('nenhum "⋯" (U+22EF) nas telas do /config e do BKO', () => {
    expect(achados(/⋯|\\u22[eE][fF]|&#8943;|&ctdot;/)).toEqual([]);
  });

  it('nenhum botão com rótulo só de reticências ("…" ou "...")', () => {
    expect(achados(/>\s*(…|\.\.\.|\{'(…|\.\.\.)'\}|\{"(…|\.\.\.)"\})\s*<\/(button|Botao|a)>/)).toEqual([]);
    expect(achados(/rotulo:\s*['"](…|\.\.\.|⋯)['"]/)).toEqual([]);
  });

  it('nenhum menu próprio nas telas: role="menu", role="menuitem" e aria-haspopup="menu" só no MenuAcoes', () => {
    expect(achados(/role=["{']+menu(item)?["}']+|aria-haspopup=["{']+(menu|true)["}']+/)).toEqual([]);
  });

  it('nenhuma cópia local do componente (função ou const MenuAcoes fora de packages/ui)', () => {
    expect(achados(/(function|const|class)\s+MenuAcoes\b/)).toEqual([]);
  });
});
