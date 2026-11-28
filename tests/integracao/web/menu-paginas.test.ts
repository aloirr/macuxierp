/**
 * T-0008, parte 2 (atualizado na T-0044 e na v0.3.28): o menu do shell (`apps/web/src/lib/menu.ts`) × as rotas que os módulos
 * declaram para as telas (`modules/cadastros/web/paginas.ts` e `modules/core/web/paginas.ts`).
 * D-02 corrigido (PR #72): o href de um item vem da rota da primeira página VISÍVEL que o módulo declara para aquele rótulo
 * (`apps/web/src/lib/paginas.ts`, `PAGINAS_REGISTRADAS`), não do slug do rótulo.
 * Decisão do PO na v0.3.28: página sem tela pronta (`ROTAS_SEM_TELA`) não aparece no menu nem abre pela URL. O item some quando
 * todas as páginas dele estão ocultas; o item "Empresa" abre no "Ambiente fiscal". A lista esperada aqui é a da decisão, não a
 * do próprio shell: o teste confere que cada rota oculta da decisão está em `ROTAS_SEM_TELA` e que nenhuma vira link.
 */
import { describe, expect, it } from 'vitest';
import { montarMenu, resolverPagina } from '../../../apps/web/src/lib/menu';
import { PAGINAS_REGISTRADAS, ROTAS_SEM_TELA } from '../../../apps/web/src/lib/paginas';
import { manifest as cadastros } from '../../../modules/cadastros/manifest';
import { manifest as core } from '../../../modules/core/manifest';
import { manifest as fiscal } from '../../../modules/fiscal/manifest';
import { PAGINA_CARGA, PAGINAS } from '../../../modules/cadastros/web/index';
import { PAGINAS_CORE } from '../../../modules/core/web/index';

const manifestos = [core, cadastros, fiscal];
const menu = montarMenu(
  manifestos.map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] })),
  manifestos,
  'administrador',
);
const hrefs = menu.flatMap((g) => g.itens.map((i) => ({ rotulo: i.rotulo, href: i.href })));
const paginas: readonly { menu: string; rota: string }[] = [...PAGINAS, ...PAGINAS_CORE];

/** Decisão do PO (v0.3.28): itens que saem do menu por não terem tela pronta. */
const ITENS_OCULTOS = ['Estoque', 'Condições de pagamento', 'Equipe e carteira', 'Tabelas oficiais', 'Regras fiscais'];
/** Decisão do PO (v0.3.28): rotas sem tela (as do item Empresa saem, o "Ambiente fiscal" fica). */
const ROTAS_OCULTAS = [
  '/cadastros/estoque',
  '/cadastros/condicoes-pagamento',
  '/cadastros/equipe',
  '/cadastros/oficiais',
  '/fiscal/regras-fiscais',
  '/core/empresa',
  '/core/empresa/certificado',
  '/core/empresa/exportacao',
];

describe('menu do shell × páginas dos módulos (D-02, v0.3.28)', () => {
  it('o menu do administrador tem os itens dos manifests, na ordem, sem os itens ocultos, cada um com uma página declarada', () => {
    const esperado = manifestos.flatMap((m) => m.web?.menus ?? []).filter((r) => !ITENS_OCULTOS.includes(r));
    expect(hrefs.map((h) => h.rotulo)).toEqual(esperado);
    expect(esperado).toEqual(['Empresa', 'Usuários e perfis', 'Clientes', 'Produtos', 'Tabelas de preço', 'Filiais']);
    for (const { rotulo } of hrefs) expect(paginas.some((p) => p.menu === rotulo), rotulo).toBe(true);
    // O grupo fiscal some inteiro: o único item dele (Regras fiscais) não tem tela.
    expect(menu.map((g) => g.modulo)).not.toContain('fiscal');
    expect(PAGINA_CARGA.api).toBe('/v1/cadastros/cargas');
  });

  it('as rotas ocultas da decisão estão em ROTAS_SEM_TELA, não viram link do menu e não abrem pela URL', () => {
    for (const rota of ROTAS_OCULTAS) {
      expect(ROTAS_SEM_TELA.has(rota), rota).toBe(true);
      // A rota continua declarada pelo módulo (a API e o manifesto não mudam); só o shell a esconde.
      expect(PAGINAS_REGISTRADAS.some((p) => p.rota === rota), rota).toBe(true);
      expect(hrefs.map((h) => h.href), rota).not.toContain(rota);
      expect(resolverPagina(menu, rota, 'administrador'), rota).toBeUndefined();
    }
    for (const rota of ROTAS_SEM_TELA) expect(hrefs.map((h) => h.href), rota).not.toContain(rota);
  });

  it('[D-02] o href de cada item é a rota da primeira página visível que o módulo declara para o rótulo; Empresa abre no Ambiente fiscal', () => {
    for (const { rotulo, href } of hrefs) {
      expect(href, rotulo).toBe(paginas.find((p) => p.menu === rotulo && !ROTAS_OCULTAS.includes(p.rota))?.rota);
      expect(resolverPagina(menu, href, 'administrador')?.rotulo, rotulo).toBe(rotulo);
    }
    expect(hrefs.find((h) => h.rotulo === 'Empresa')?.href).toBe('/core/empresa/ambiente-fiscal');
  });
});
