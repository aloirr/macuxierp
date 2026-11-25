/**
 * Proteção do defeito do D-4 (T-0086, R-20261124-211655): no #564, `clientes-recebidos.tsx` era componente de servidor e
 * passava `chaveLinha` e `celula` (funções) à `TabelaDensa` (client); em produção a tela caía com "Functions cannot be
 * passed to Client Components", sem teste que pegasse. O #576 pôs 'use client'. Aqui, checagem estática: todo .tsx do
 * web (apps/web/src e modules/<m>/web) que renderiza `<TabelaDensa` passando função (`chaveLinha=` ou `celula`) começa
 * com a diretiva 'use client'.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arquivosDoWeb, RAIZ } from '../../apoio/caminhos';

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/;

const ALVOS = arquivosDoWeb()
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ arquivo: relative(RAIZ, f), fonte: readFileSync(f, 'utf8') }))
  .filter(({ fonte }) => /<TabelaDensa\b/.test(fonte) && /\bchaveLinha=|\bcelula\b/.test(fonte));

describe("TabelaDensa com função só em componente 'use client' (defeito do D-4)", () => {
  it('a varredura acha os componentes que usam a TabelaDensa (não ficou vazia)', () => {
    expect(ALVOS.map((a) => a.arquivo)).toEqual(expect.arrayContaining(['apps/web/src/components/integracao-fdv/clientes-recebidos.tsx']));
  });
  it("todo .tsx que passa chaveLinha ou celula à TabelaDensa começa com 'use client'", () => {
    expect(ALVOS.filter(({ fonte }) => !USE_CLIENT.test(fonte)).map((a) => a.arquivo)).toEqual([]);
  });
});
