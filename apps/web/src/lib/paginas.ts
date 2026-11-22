import { PAGINAS, PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { PAGINAS_CORE } from '@macuxierp/core/web';
import { pode, type Acao, type ModuloId, type Perfil } from '@macuxierp/platform-sdk';

/** Página que um módulo declara para o BKO, no que o shell precisa (D-02: a rota vem do módulo, não do rótulo). */
export interface PaginaRegistrada {
  modulo: ModuloId;
  /** Rótulo do item de menu a que a página pertence (`menu` da página). */
  menu: string;
  titulo: string;
  rota: string;
  /** Faixa no topo da página, quando o módulo declara (T-0040). */
  aviso?: string;
  /** Permissão para ver a página (esconde, não protege: a API checa de novo). Sem `ver`, vale a do módulo. */
  ver?: Acao;
}

/** Fonte única de rota e menu: o menu e a rota `[modulo]/[...pagina]` leem daqui. Módulo novo registra as páginas aqui. */
export const PAGINAS_REGISTRADAS: readonly PaginaRegistrada[] = [
  ...PAGINAS_CORE.map((p): PaginaRegistrada => ({ modulo: 'core', menu: p.menu, titulo: p.titulo, rota: p.rota, ver: p.ver, ...(p.aviso ? { aviso: p.aviso } : {}) })),
  ...PAGINAS.map((p): PaginaRegistrada => ({ modulo: 'cadastros', menu: p.menu, titulo: p.titulo, rota: p.rota })),
  // Carga de cadastros (T-0026): fora de PAGINAS, entra pelo mesmo descritor.
  { modulo: 'cadastros', menu: PAGINA_CARGA.menu, titulo: PAGINA_CARGA.titulo, rota: PAGINA_CARGA.rota, ver: 'cadastros.carga.executar' },
];

/** A página aparece para o perfil (mesma regra de `paginasVisiveis` do core). */
export function paginaVisivel(p: PaginaRegistrada, perfil: Perfil): boolean {
  return !p.ver || pode(perfil, p.ver);
}

/** Páginas declaradas para o item de menu, na ordem do módulo; só as que o perfil vê, quando o perfil é informado. */
export function paginasDoMenu(modulo: ModuloId, rotulo: string, perfil?: Perfil, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): PaginaRegistrada[] {
  return paginas.filter((p) => p.modulo === modulo && p.menu === rotulo && (!perfil || paginaVisivel(p, perfil)));
}

/** Página pela rota completa (`/core/empresa/certificado`). */
export function paginaDaRota(rota: string, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): PaginaRegistrada | undefined {
  return paginas.find((p) => p.rota === rota);
}
