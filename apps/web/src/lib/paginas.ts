import { PAGINAS, PAGINA_CARGA } from '@macuxierp/cadastros/web';
import { PAGINAS_CORE } from '@macuxierp/core/web';
import { PAGINAS_PEDIDO } from '@macuxierp/pedido/web';
import { paginaVisivel, type ModuloId, type PaginaBase, type Perfil } from '@macuxierp/platform-sdk';

/** Página que um módulo declara para o BKO (RD-0178: tipo base do SDK + o módulo dono). A rota vem do módulo, não do rótulo (D-02). */
export interface PaginaRegistrada extends PaginaBase {
  modulo: ModuloId;
  /** Fora do menu (detalhe `/:id` e "novo"): resolve a rota, mas não vira link nem escolhe o destino do item de menu. */
  ocultaNoMenu?: boolean;
}

/** Fonte única de rota e menu: o menu e a rota `[modulo]/[...pagina]` leem daqui. Módulo novo registra as páginas aqui. */
/** Só o que o menu e a rota precisam do descritor do módulo (a lista, colunas e API ficam no módulo). */
function registrar(modulo: ModuloId, p: PaginaBase, extra: { ocultaNoMenu?: boolean } = {}): PaginaRegistrada {
  return { modulo, menu: p.menu, titulo: p.titulo, rota: p.rota, ...(p.ver ? { ver: p.ver } : {}), ...(p.aviso ? { aviso: p.aviso } : {}), ...extra };
}

export const PAGINAS_REGISTRADAS: readonly PaginaRegistrada[] = [
  ...PAGINAS_CORE.map((p) => registrar('core', p)),
  ...PAGINAS.map((p) => registrar('cadastros', p)),
  // Carga de cadastros (T-0026): fora de PAGINAS, entra pelo mesmo descritor.
  registrar('cadastros', PAGINA_CARGA),
  // Pedido (T-0015): detalhe `/:id` e "novo" ficam fora do menu; `/novo` vence `/:id` por ser rota exata (casarRota).
  ...PAGINAS_PEDIDO.map((p) => registrar('pedido', p, { ocultaNoMenu: p.tipo !== 'lista' })),
];

export { paginaVisivel };

/** Páginas declaradas para o item de menu, na ordem do módulo; só as que o perfil vê, quando o perfil é informado. */
export function paginasDoMenu(modulo: ModuloId, rotulo: string, perfil?: Perfil, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): PaginaRegistrada[] {
  return paginas.filter((p) => p.modulo === modulo && p.menu === rotulo && !p.ocultaNoMenu && (!perfil || paginaVisivel(p, perfil)));
}

/** Página pela rota completa (`/core/empresa/certificado`). Rota exata; o detalhe `/:id` passa por `casarRota`. */
export function paginaDaRota(rota: string, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): PaginaRegistrada | undefined {
  return paginas.find((p) => p.rota === rota);
}

export interface RotaCasada {
  pagina: PaginaRegistrada;
  params: Readonly<Record<string, string>>;
}

/**
 * Resolve a rota pedida: primeiro a exata (`/pedido/pedidos/novo` vence `/pedido/pedidos/:id`), depois a com parâmetro `:nome`
 * (um segmento). O parâmetro entra como texto; quem usa valida (ex.: UUID) antes de chamar a API.
 */
export function casarRota(rota: string, paginas: readonly PaginaRegistrada[] = PAGINAS_REGISTRADAS): RotaCasada | undefined {
  const exata = paginaDaRota(rota, paginas);
  if (exata) return { pagina: exata, params: {} };
  const partes = rota.split('/');
  for (const pagina of paginas) {
    if (!pagina.rota.includes(':')) continue;
    const molde = pagina.rota.split('/');
    if (molde.length !== partes.length) continue;
    const params: Record<string, string> = {};
    const bate = molde.every((m, i) => {
      const parte = partes[i] ?? '';
      if (!m.startsWith(':')) return m === parte;
      if (!parte) return false;
      try {
        params[m.slice(1)] = decodeURIComponent(parte);
      } catch {
        return false;
      }
      return true;
    });
    if (bate) return { pagina, params };
  }
  return undefined;
}
