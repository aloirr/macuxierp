/**
 * T-0008, parte 2: o menu do shell (`apps/web/src/lib/menu.ts`, href = `/<modulo>/<slug do rótulo>`) × as rotas que os
 * módulos declaram para as telas (`modules/cadastros/web/paginas.ts` e `modules/core/web/paginas.ts`). Cada lado tem o
 * próprio teste (menu.test.ts; paginas.test.ts e web.test.ts) e nenhum confere o outro.
 * D-02: hoje cinco itens do menu levam a um endereço que nenhuma página declara (reconferido no main 2176b43). O
 * `it.fails` traz o esperado ([]) e o "hoje" ao lado fixa a lista exata dos 5; corrigido, o "hoje" sai e o `it.fails` vira `it`.
 * T-0026: a página "Carga de cadastros" (`PAGINA_CARGA`, fora de `PAGINAS`) chega com o PR do cadastros. Este arquivo vale
 * com e sem ela: os itens do menu são os rótulos dos manifests, na ordem, e o da carga entra uma vez se a página existir.
 * O D-02 da carga só é registrado enquanto o href do rótulo e a rota da página divergirem.
 * O módulo web é lido por namespace, para o typecheck não quebrar enquanto o export não existe.
 */
import { describe, expect, it } from 'vitest';
import { montarMenu, slug } from '../../../apps/web/src/lib/menu';
import { manifest as cadastros } from '../../../modules/cadastros/manifest';
import { manifest as core } from '../../../modules/core/manifest';
import * as webCadastros from '../../../modules/cadastros/web/index';
import { PAGINAS } from '../../../modules/cadastros/web/index';
import { PAGINAS_CORE } from '../../../modules/core/web/index';
import { pode, PERFIS, type Perfil } from '../../../packages/platform-sdk/src/index';

const menu = montarMenu(
  [core, cadastros].map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] })),
  [core, cadastros],
  'administrador',
);
const hrefs = menu.flatMap((g) => g.itens.map((i) => ({ rotulo: i.rotulo, href: i.href })));

/** T-0026: a página de carga e as ações dela, se o PR do cadastros já entrou (senão, `undefined`). */
const extra = webCadastros as unknown as {
  PAGINA_CARGA?: { menu: string; rota: string; api: string };
  acoesDaCarga?: (perfil: Perfil) => { abrir: boolean; validar: boolean; gravar: boolean };
};
const carga = extra.PAGINA_CARGA;
const paginas: readonly { menu: string; rota: string }[] = [...PAGINAS, ...PAGINAS_CORE, ...(carga ? [carga] : [])];
const rotas = new Set(paginas.map((p) => p.rota));

const rotulos = hrefs.map((h) => h.rotulo);
/** Rótulos dos manifests, na ordem do menu, sem o da carga (T-0026): o menu tem estes e, no máximo, a carga a mais. */
const ROTULOS_SEM_CARGA = [...core.web!.menus, ...cadastros.web!.menus].filter((r) => r !== carga?.menu);
/**
 * D-02 hoje: hrefs sem página, na ordem do menu. Com a carga (último item do cadastros), o href do rótulo
 * (`/cadastros/carga-de-cadastros`) entra no fim se a rota declarada (`/cadastros/carga`) for outra.
 */
const SEM_PAGINA_HOJE = [
  '/core/usuarios-e-perfis',
  '/cadastros/tabelas-de-preco',
  '/cadastros/condicoes-de-pagamento',
  '/cadastros/equipe-e-carteira',
  '/cadastros/tabelas-oficiais',
];
const hrefCarga = carga ? `/cadastros/${slug(carga.menu)}` : undefined;
const semPaginaEsperado = hrefCarga && !rotas.has(hrefCarga) ? [...SEM_PAGINA_HOJE, hrefCarga] : SEM_PAGINA_HOJE;

describe('menu do shell × páginas dos módulos (D-02)', () => {
  it('o menu do administrador tem os itens dos manifests de core e cadastros, na ordem (+ a carga, T-0026), cada um com uma página declarada pelo rótulo', () => {
    expect(rotulos.filter((r) => r !== carga?.menu)).toEqual(ROTULOS_SEM_CARGA);
    expect(rotulos).toHaveLength(ROTULOS_SEM_CARGA.length + (carga ? 1 : 0));
    for (const { rotulo } of hrefs) expect(paginas.some((p) => p.menu === rotulo), rotulo).toBe(true);
  });

  it.skipIf(!carga)('T-0026: a página "Carga de cadastros" chama POST /v1/cadastros/cargas e segue cadastros.carga.executar', () => {
    expect(carga!.api).toBe('/v1/cadastros/cargas');
    expect(extra.acoesDaCarga).toBeTypeOf('function');
    for (const perfil of PERFIS) {
      const pode_ = pode(perfil, 'cadastros.carga.executar');
      expect(extra.acoesDaCarga!(perfil), perfil).toEqual({ abrir: pode_, validar: pode_, gravar: pode_ });
    }
    expect(PERFIS.filter((p) => pode(p, 'cadastros.carga.executar'))).toEqual(['administrador', 'gerente']);
  });

  it.fails('[D-02] todo href do menu do shell é a rota de uma página declarada pelo módulo', () => {
    expect(hrefs.filter((h) => !rotas.has(h.href)).map((h) => h.href)).toEqual([]);
  });

  it('[D-02, hoje] hrefs do menu sem página: exatamente estes (corrigido, este sai e o it.fails ao lado vira it)', () => {
    expect(hrefs.filter((h) => !rotas.has(h.href)).map((h) => h.href)).toEqual(semPaginaEsperado);
  });
});
