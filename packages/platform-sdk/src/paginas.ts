/**
 * Tipo base de página do BKO (RD-0178), num lugar só para os módulos e o shell. Sem dependência de Node: o shell
 * (`apps/web`) importa por `@macuxierp/platform-sdk/paginas` (ou pelo índice do pacote).
 *
 * Cada módulo descreve as páginas em `modules/<m>/web` estendendo `PaginaBase` (`interface PaginaCore extends
 * PaginaBase { ... }`; página avulsa com tipo próprio, `const PAGINA_CARGA: PaginaCarga = {...}`, em que
 * `PaginaCarga extends PaginaBase`), e o shell concatena os arrays dos módulos,
 * sem cópia local do tipo. A lista da página (API, colunas, filtros, CSV) continua no descritor `PaginaLista` da T-0041
 * (`definirPaginaLista`, em `./listas`): este tipo é só o que o menu e a rota do shell precisam.
 */
import type { Perfil } from './modulo';
import { pode, type Acao } from './permissoes';

export interface PaginaBase {
  /** Identificador da página no módulo (o mesmo segmento `id` do `PaginaLista`, quando a página é lista). */
  readonly id?: string;
  /** Rótulo do item de menu a que a página pertence (um dos `web.menus` do manifesto do módulo). */
  readonly menu: string;
  /** Título no topo da página. */
  readonly titulo: string;
  /** Rota completa no shell, `/<modulo>/...` (a rota vem do módulo, não do rótulo do menu). */
  readonly rota: string;
  /** Faixa de aviso no topo da página, quando houver (ex.: T-0040). */
  readonly aviso?: string;
  /** Ação que libera ver a página e o item de menu. Sem `ver`, vale a licença e o perfil do módulo. */
  readonly ver?: Acao;
}

/** A página aparece para o perfil: sem `ver`, sempre; com `ver`, só se `pode(perfil, ver)`. Esconde, não protege: a API checa de novo (RN-CORE-02). */
export function paginaVisivel(pagina: PaginaBase, perfil: Perfil): boolean {
  return !pagina.ver || pode(perfil, pagina.ver);
}
