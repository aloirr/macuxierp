import type { EuResposta, ManifestoModulo, ModuloId, Perfil } from '@macuxierp/platform-sdk';

export interface ItemMenu {
  rotulo: string;
  href: string;
}
export interface GrupoMenu {
  modulo: ModuloId;
  itens: ItemMenu[];
}

/** "Tabelas de preço" -> "tabelas-de-preco" (segmento de URL estável a partir do rótulo do manifesto). */
export function slug(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Monta o menu (RN-CORE-02, RD-11). Fonte dos rótulos e da ordem: `eu.modulos[].menus` da API, que já traz só os
 * módulos licenciados. O manifesto entra apenas no filtro de `perfis` (o servidor revalida em toda rota).
 */
export function montarMenu(modulos: EuResposta['modulos'], manifestos: readonly ManifestoModulo[], perfil: Perfil): GrupoMenu[] {
  return modulos
    .filter((m) => m.menus.length > 0 && manifestos.some((f) => f.id === m.id && f.perfis.includes(perfil)))
    .map((m) => ({
      modulo: m.id,
      itens: m.menus.map((rotulo) => ({ rotulo, href: `/${m.id}/${slug(rotulo)}` })),
    }));
}

/** Resolve a rota /<modulo>/<pagina> para o rótulo do menu, ou undefined se o módulo/perfil/página não valer. */
export function rotuloDaPagina(menu: readonly GrupoMenu[], modulo: string, pagina: string): string | undefined {
  return menu.find((g) => g.modulo === modulo)?.itens.find((i) => i.href === `/${modulo}/${pagina}`)?.rotulo;
}
