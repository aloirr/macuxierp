/**
 * T-0008, parte 2: o menu do shell (`apps/web/src/lib/menu.ts`, href = `/<modulo>/<slug do rótulo>`) × as rotas que os
 * módulos declaram para as telas (`modules/cadastros/web/paginas.ts` e `modules/core/web/paginas.ts`). Cada lado tem o
 * próprio teste (menu.test.ts; paginas.test.ts e web.test.ts) e nenhum confere o outro.
 * D-02: hoje cinco itens do menu levam a um endereço que nenhuma página declara (reconferido no main 2176b43). O
 * `it.fails` traz o esperado ([]) e o "hoje" ao lado fixa a lista exata dos 5; corrigido, o "hoje" sai e o `it.fails` vira `it`.
 */
import { describe, expect, it } from 'vitest';
import { montarMenu } from '../../../apps/web/src/lib/menu';
import { manifest as cadastros } from '../../../modules/cadastros/manifest';
import { manifest as core } from '../../../modules/core/manifest';
import { PAGINAS } from '../../../modules/cadastros/web/index';
import { PAGINAS_CORE } from '../../../modules/core/web/index';

const menu = montarMenu(
  [core, cadastros].map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] })),
  [core, cadastros],
  'administrador',
);
const hrefs = menu.flatMap((g) => g.itens.map((i) => ({ rotulo: i.rotulo, href: i.href })));
const rotas = new Set([...PAGINAS.map((p) => p.rota), ...PAGINAS_CORE.map((p) => p.rota)]);

describe('menu do shell × páginas dos módulos (D-02)', () => {
  it('o menu do administrador tem os 10 itens de core e cadastros, cada um com uma página declarada pelo rótulo', () => {
    expect(hrefs).toHaveLength(10);
    for (const { rotulo } of hrefs) expect([...PAGINAS, ...PAGINAS_CORE].some((p) => p.menu === rotulo), rotulo).toBe(true);
  });

  it.fails('[D-02] todo href do menu do shell é a rota de uma página declarada pelo módulo', () => {
    expect(hrefs.filter((h) => !rotas.has(h.href)).map((h) => h.href)).toEqual([]);
  });

  it('[D-02, hoje] hrefs do menu sem página: exatamente estes 5 (corrigido, este sai e o it.fails ao lado vira it)', () => {
    expect(hrefs.filter((h) => !rotas.has(h.href)).map((h) => h.href)).toEqual([
      '/core/usuarios-e-perfis',
      '/cadastros/tabelas-de-preco',
      '/cadastros/condicoes-de-pagamento',
      '/cadastros/equipe-e-carteira',
      '/cadastros/tabelas-oficiais',
    ]);
  });
});
