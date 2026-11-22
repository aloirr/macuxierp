/**
 * T-0008, parte 2 (atualizado na T-0044): o menu do shell (`apps/web/src/lib/menu.ts`) × as rotas que os módulos declaram
 * para as telas (`modules/cadastros/web/paginas.ts`, `modules/cadastros/web/carga.ts` e `modules/core/web/paginas.ts`).
 * D-02 corrigido (PR #72): o href de um item vem da rota da primeira página que o módulo declara para aquele rótulo
 * (`apps/web/src/lib/paginas.ts`, `PAGINAS_REGISTRADAS`), não mais do slug do rótulo; o slug só vale para módulo que ainda
 * não declara páginas (pedido, faturamento, fiscal). Aqui se confere, de fora do shell, que todo item do menu do
 * administrador de core e cadastros aponta para uma rota declarada pelo módulo, inclusive a "Carga de cadastros" (T-0026).
 */
import { describe, expect, it } from 'vitest';
import { montarMenu } from '../../../apps/web/src/lib/menu';
import { manifest as cadastros } from '../../../modules/cadastros/manifest';
import { manifest as core } from '../../../modules/core/manifest';
import { PAGINA_CARGA, PAGINAS } from '../../../modules/cadastros/web/index';
import { PAGINAS_CORE } from '../../../modules/core/web/index';

const menu = montarMenu(
  [core, cadastros].map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] })),
  [core, cadastros],
  'administrador',
);
const hrefs = menu.flatMap((g) => g.itens.map((i) => ({ rotulo: i.rotulo, href: i.href })));
const paginas: readonly { menu: string; rota: string }[] = [...PAGINAS, ...PAGINAS_CORE, PAGINA_CARGA];

describe('menu do shell × páginas dos módulos (D-02)', () => {
  it('o menu do administrador tem os itens dos manifests de core e cadastros, na ordem, cada um com uma página declarada pelo rótulo', () => {
    expect(hrefs.map((h) => h.rotulo)).toEqual([...core.web!.menus, ...cadastros.web!.menus]);
    for (const { rotulo } of hrefs) expect(paginas.some((p) => p.menu === rotulo), rotulo).toBe(true);
    expect(PAGINA_CARGA.api).toBe('/v1/cadastros/cargas');
  });

  it('[D-02] o href de cada item é a rota da primeira página que o módulo declara para o rótulo', () => {
    for (const { rotulo, href } of hrefs) expect(href, rotulo).toBe(paginas.find((p) => p.menu === rotulo)?.rota);
  });
});
