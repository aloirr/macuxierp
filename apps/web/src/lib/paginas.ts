import { PAGINAS, PAGINAS_EDICAO } from '@macuxierp/cadastros/web';
import { PAGINAS_CORE } from '@macuxierp/core/web';
import { PAGINAS_FATURAMENTO } from '@macuxierp/faturamento/web';
import { PAGINAS_INTEGRACAO_FDV } from '@macuxierp/integracao-fdv/web';
import { PAGINAS_PEDIDO } from '@macuxierp/pedido/web';
import { ROTA_BANDEIRA } from './telas/bandeira';
import { PAGINAS_CADASTROS_OUTROS, ROTAS_DO_ADAPTADOR } from './telas/cadastros-outros';
import { ROTA_USUARIO_NOVO } from './telas/core';
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
  return { modulo, menu: p.menu, titulo: p.titulo, rota: p.rota, ...(p.ver ? { ver: p.ver } : {}), ...(p.aviso ? { aviso: p.aviso } : {}), ...(p.ocultaNoMenu !== undefined ? { ocultaNoMenu: p.ocultaNoMenu } : {}), ...extra };
}

/**
 * Decisão do PO (v0.3.28): página sem tela pronta não aparece no menu (nenhum item cai em "Disponível em breve"). O shell oculta aqui, sem mexer nos
 * manifestos; o item some quando todas as páginas dele estão ocultas, e o item "Empresa" abre no "Ambiente fiscal" (a primeira página visível).
 * Para voltar ao menu, tire a rota da lista no dia em que a tela entrar.
 */
export const ROTAS_SEM_TELA: ReadonlySet<string> = new Set([
  // cadastros: Estoque, Tabelas oficiais, Condições e Equipe entraram na T-0123 (lotes A e B); nenhuma rota do cadastros fica sem tela
  '/core/empresa', '/core/empresa/certificado', '/core/empresa/exportacao', // core: o "Ambiente fiscal" fica
  '/fiscal/regras-fiscais', // fiscal: o módulo ainda não declara páginas
]);
const semTela = (p: PaginaBase) => ROTAS_SEM_TELA.has(p.rota);

export const PAGINAS_REGISTRADAS: readonly PaginaRegistrada[] = [
  ...PAGINAS_CORE.map((p) => registrar('core', p, semTela(p) ? { ocultaNoMenu: true } : {})),
  // Usuário novo (T-0087): formulário fora do menu, aberto pelo botão "Novo usuário" da lista (só quem gerencia usuários).
  registrar('core', { menu: 'Usuários e perfis', titulo: 'Novo usuário', rota: ROTA_USUARIO_NOVO, ver: 'core.usuario.gerir' }, { ocultaNoMenu: true }),
  ...PAGINAS.filter((p) => !ROTAS_DO_ADAPTADOR.has(p.rota)).map((p) => registrar('cadastros', p, semTela(p) ? { ocultaNoMenu: true } : {})),
  // Estoque e Tabelas oficiais (T-0123, lote A): só leitura; o adaptador em lib/telas/cadastros-outros declara as páginas (Oficiais tem 4 seções).
  ...PAGINAS_CADASTROS_OUTROS.map((p) => registrar('cadastros', p)),
  // Regras fiscais: o módulo fiscal ainda não declara páginas; o item sai do menu até a tela existir.
  registrar('fiscal', { menu: 'Regras fiscais', titulo: 'Regras fiscais', rota: '/fiscal/regras-fiscais' }, { ocultaNoMenu: true }),
  // Clientes, Produtos, Filiais e Tabelas de preço (v0.3.28): novo e edição ligados; as demais telas de edição do cadastros entram com a T-0123 (v0.3.29).
  ...PAGINAS_EDICAO.filter((p) => ['Clientes', 'Produtos', 'Filiais', 'Tabelas de preço'].includes(p.menu)).map((p) => registrar('cadastros', p)),
  // Carga de cadastros (T-0058): saiu do BKO; é feita na aba Cargas do /config (superadmin). A API /v1/cadastros/cargas continua.
  // Pedido (T-0015): detalhe `/:id` e "novo" abrem pela URL sem item de menu; `/novo` vence `/:id` por ser rota exata (casarRota).
  // O módulo já marca `ocultaNoMenu` em novo e detalhe (#135), mas não no editar; até marcar, o shell aplica a ponte (o campo do módulo vence).
  ...PAGINAS_PEDIDO.map((p) => registrar('pedido', p, { ocultaNoMenu: p.ocultaNoMenu ?? p.tipo !== 'lista' })),
  // Integração FDV (T-0011): o monitor é o item de menu; os envios (lotes) abrem a partir dele (`ocultaNoMenu` vem do módulo).
  ...PAGINAS_INTEGRACAO_FDV.map((p) => registrar('integracao-fdv', p)),
  // Faturamento (T-0021): tudo vem do módulo; os detalhes da nota e do título (`/:id`) ficam fora do menu (`ocultaNoMenu` do módulo).
  ...PAGINAS_FATURAMENTO.map((p) => registrar('faturamento', p)),
  // Bandeira "faturamento real com NF-e simulada" por filial (T-0088): seção do item Notas fiscais; só o administrador liga e desliga.
  registrar('faturamento', { menu: 'Notas fiscais', titulo: 'Bandeira da NF-e simulada', rota: ROTA_BANDEIRA, ver: 'faturamento.ver' }),
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
