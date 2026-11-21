import type { ManifestoModulo, ModuloId, Perfil } from '@macuxierp/platform-sdk';

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
 * Monta o menu pelos manifestos (RN-CORE-02): só módulo licenciado para o tenant e que aceita o perfil do usuário.
 * A licença vem de GET /v1/auth/eu; o servidor revalida em toda rota (o menu é só conveniência).
 */
export function montarMenu(manifestos: readonly ManifestoModulo[], licenciados: readonly ModuloId[], perfil: Perfil): GrupoMenu[] {
  return manifestos
    .filter((m) => licenciados.includes(m.id) && m.perfis.includes(perfil) && (m.web?.menus.length ?? 0) > 0)
    .map((m) => ({
      modulo: m.id,
      itens: (m.web?.menus ?? []).map((rotulo) => ({ rotulo, href: `/${m.id}/${slug(rotulo)}` })),
    }));
}

/** Resolve a rota /<modulo>/<pagina> para o rótulo do menu, ou undefined se o módulo/perfil/página não valer. */
export function rotuloDaPagina(menu: readonly GrupoMenu[], modulo: string, pagina: string): string | undefined {
  return menu.find((g) => g.modulo === modulo)?.itens.find((i) => i.href === `/${modulo}/${pagina}`)?.rotulo;
}
