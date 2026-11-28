import type { EuResposta, ManifestoModulo, ModuloId, Perfil } from '@macuxierp/platform-sdk';
import { casarRota, paginasDoMenu, paginaVisivel, type PaginaRegistrada, PAGINAS_REGISTRADAS, ROTAS_SEM_TELA } from './paginas';

export interface ItemMenu {
  rotulo: string;
  href: string;
}
export interface GrupoMenu {
  modulo: ModuloId;
  itens: ItemMenu[];
}

/** "Tabelas de preço" -> "tabelas-de-preco". Só para módulo que ainda não declara páginas (pedido, faturamento, fiscal): com páginas, a rota vem delas (D-02). */
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
export function montarMenu(
  modulos: EuResposta['modulos'],
  manifestos: readonly ManifestoModulo[],
  perfil: Perfil,
  paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS,
): GrupoMenu[] {
  return modulos
    .filter((m) => m.menus.length > 0 && manifestos.some((f) => f.id === m.id && f.perfis.includes(perfil)))
    .map((m) => ({
      modulo: m.id,
      itens: m.menus.flatMap((rotulo): ItemMenu[] => {
        const declaradas = paginas.some((p) => p.modulo === m.id && p.menu === rotulo);
        if (!declaradas) return [{ rotulo, href: `/${m.id}/${slug(rotulo)}` }];
        // O link aponta para a primeira página que o perfil vê; sem nenhuma visível, o item some.
        const primeira = paginasDoMenu(m.id, rotulo, perfil, paginas)[0];
        return primeira ? [{ rotulo, href: primeira.rota }] : [];
      }),
    }))
    .filter((g) => g.itens.length > 0);
}

export interface PaginaResolvida {
  rotulo: string;
  /** Página declarada pelo módulo; ausente quando a rota vem só do rótulo do manifesto (módulo sem páginas). */
  pagina?: PaginaRegistrada;
  /** Parâmetros da rota com `:nome` (ex.: `id` do detalhe). */
  params?: Readonly<Record<string, string>>;
}

/**
 * Resolve a rota (`/<modulo>/<...pagina>`) para o item de menu e a página, numa busca só. Undefined se módulo, perfil,
 * `ver` da página ou rota não valerem.
 */
export function resolverPagina(menu: readonly GrupoMenu[], rota: string, perfil: Perfil, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): PaginaResolvida | undefined {
  const modulo = rota.split('/')[1];
  const grupo = menu.find((g) => g.modulo === modulo);
  if (!grupo) return undefined;
  // Página sem tela (ROTAS_SEM_TELA) não abre nem pela URL: seguiria para "Disponível em breve".
  const casada = ROTAS_SEM_TELA.has(rota) ? undefined : casarRota(rota, paginas);
  if (casada) {
    const { pagina, params } = casada;
    return paginaVisivel(pagina, perfil) && grupo.itens.some((i) => i.rotulo === pagina.menu) ? { rotulo: pagina.menu, pagina, params } : undefined;
  }
  const item = grupo.itens.find((i) => i.href === rota);
  return item ? { rotulo: item.rotulo } : undefined;
}

/**
 * Href do item de menu que fica marcado na rota atual: o da própria lista ou, no detalhe (`/faturamento/notas/<id>`, `/pedido/pedidos/<id>/editar`), o da lista de origem.
 * Vence o href mais longo que é prefixo da rota por segmento inteiro; o início (`/`) só marca a si mesmo.
 */
export function hrefAtivo(atual: string, hrefs: readonly string[]): string | undefined {
  const caminho = atual.split('?')[0] ?? atual;
  let melhor: string | undefined;
  for (const h of hrefs) {
    if (h === '/' ? caminho === '/' : caminho === h || caminho.startsWith(`${h}/`)) if (!melhor || h.length > melhor.length) melhor = h;
  }
  return melhor;
}
