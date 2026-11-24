/**
 * Páginas do BKO do módulo cadastros, descritas como dados (rota, menu, API, colunas, filtros e permissões). O shell
 * (apps/web, Next.js) desenha tabela densa, filtros na URL e botão "Exportar CSV" a partir daqui. A permissão na tela
 * só esconde o botão: a proteção real é a da API (RN-CORE-02).
 */
import { ConsultaLista, ConsultaPaginada, LIMITE_PADRAO, lerFiltros, paraCsv, pode, type Acao, type ColunaCsv, type PaginaBase, type Perfil, type ValorCsv } from '@macuxierp/platform-sdk';
import { formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { situacao } from './edicao';
import { ROTA_CLIENTE, ROTA_CLIENTE_NOVO, ROTA_CLIENTES, paginaClientes } from './clientes';
import { ROTA_FILIAL, ROTA_FILIAIS, ROTA_FILIAL_NOVA, paginaFiliais } from './filiais';
import { ROTA_PRODUTO, ROTA_PRODUTO_NOVO, ROTA_PRODUTOS, paginaProdutos } from './produtos';
import { ROTA_TABELA_PRECO, ROTA_TABELA_PRECO_NOVA, ROTA_TABELAS_PRECO, paginaTabelasPreco } from './precos';

export interface ColunaPagina {
  chave: string;
  rotulo: string;
  formatar?: (valor: unknown) => string;
  /** Só quem pode ver o dado (ex.: o custo do produto). */
  exige?: Acao;
}

export interface PaginaCadastros extends PaginaBase {
  /** Toda página do cadastros é lista e tem `id` (no tipo base ele é opcional). */
  readonly id: string;
  /** Caminho da lista em `/v1/cadastros`. */
  api: string;
  colunas: readonly ColunaPagina[];
  /** Filtros aceitos na URL, além de `busca`, `cursor`, `limite` e `inativos`. */
  filtros: readonly string[];
  editar?: Acao;
  /** Campos que pedem permissão a mais além de `editar`. */
  restritos?: readonly { campo: string; exige: Acao }[];
}

const ATIVO: ColunaPagina = { chave: 'inativo', rotulo: 'Situação', formatar: situacao };

/** O que a lista declarada pelo SDK (`definirPaginaLista`) dá ao descritor do shell: API, filtros e colunas. */
interface ListaDoSdk {
  readonly id: string;
  readonly api: string;
  readonly filtros: Readonly<Record<string, unknown>>;
  readonly colunas: readonly { id: string; titulo: string; valor: (linha: never) => ValorCsv; exige?: Acao }[];
}

/**
 * Lista única (T-0088): API, filtros, colunas, títulos e formatação vêm do descritor da lista do SDK, o mesmo que a API usa no
 * CSV. Cada coluna lê só o próprio campo da linha, então `formatar(valor)` monta uma linha de um campo só.
 */
function daLista(l: ListaDoSdk): Pick<PaginaCadastros, 'id' | 'api' | 'filtros' | 'colunas'> {
  return {
    id: l.id,
    api: l.api,
    filtros: Object.keys(l.filtros),
    colunas: l.colunas.map((c) => ({
      chave: c.id, rotulo: c.titulo, ...(c.exige ? { exige: c.exige } : {}),
      formatar: (v: unknown) => String((c.valor as (linha: unknown) => ValorCsv)({ [c.id]: v }) ?? ''),
    })),
  };
}

export const PAGINAS: readonly PaginaCadastros[] = [
  {
    menu: 'Clientes', titulo: 'Clientes', rota: ROTA_CLIENTES, ...daLista(paginaClientes),
    editar: 'cadastros.cliente.editar', restritos: [{ campo: 'limite_credito_centavos', exige: 'cadastros.cliente.credito' }],
  },
  {
    menu: 'Produtos', titulo: 'Produtos', rota: ROTA_PRODUTOS, ...daLista(paginaProdutos),
    editar: 'cadastros.produto.editar',
  },
  {
    menu: 'Tabelas de preço', titulo: 'Tabelas de preço', rota: ROTA_TABELAS_PRECO, ...daLista(paginaTabelasPreco),
    editar: 'cadastros.preco.editar',
  },
  {
    id: 'estoque', menu: 'Estoque', titulo: 'Estoque', rota: '/cadastros/estoque', api: '/v1/cadastros/estoque', filtros: ['filial_id', 'produto_id'],
    colunas: [{ chave: 'filial_id', rotulo: 'Filial' }, { chave: 'produto_id', rotulo: 'Produto' }, { chave: 'quantidade', rotulo: 'Saldo', formatar: (v) => formatarQuantidade(Number(v ?? 0)) }],
    editar: 'cadastros.estoque.movimentar', restritos: [{ campo: 'saldo_negativo', exige: 'cadastros.estoque.negativo' }],
  },
  {
    id: 'condicoes-pagamento', menu: 'Condições de pagamento', titulo: 'Condições de pagamento', rota: '/cadastros/condicoes-pagamento', api: '/v1/cadastros/condicoes-pagamento', filtros: [],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'descricao', rotulo: 'Descrição' }, { chave: 'forma_tpag', rotulo: 'Forma de pagamento' }, { chave: 'prazos_dias', rotulo: 'Prazos (dias)', formatar: (v) => (Array.isArray(v) ? v.join('/') : '') }, { chave: 'parcelas_cartao', rotulo: 'Parcelas', formatar: (v) => (typeof v === 'number' ? `${v}x` : '') }, ATIVO],
    editar: 'cadastros.condicao_pagamento.editar',
  },
  {
    id: 'vendedores', menu: 'Equipe e carteira', titulo: 'Equipe e carteira', rota: '/cadastros/equipe', api: '/v1/cadastros/vendedores', filtros: ['filial_id'],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'nome', rotulo: 'Vendedor' }, { chave: 'filial_id', rotulo: 'Filial' }, ATIVO],
    editar: 'cadastros.vendedor.editar', restritos: [{ campo: 'carteira', exige: 'cadastros.carteira.transferir' }],
  },
  {
    menu: 'Filiais', titulo: 'Filiais', rota: ROTA_FILIAIS, ...daLista(paginaFiliais),
    editar: 'cadastros.filial.editar',
  },
  {
    id: 'oficiais', menu: 'Tabelas oficiais', titulo: 'Tabelas oficiais', rota: '/cadastros/oficiais', api: '/v1/cadastros/oficiais/ncm', filtros: ['uf', 'tipo', 'data'],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'descricao', rotulo: 'Descrição' }, { chave: 'vigencia_inicio', rotulo: 'Vigência desde' }, { chave: 'vigencia_fim', rotulo: 'Vigência até' }],
  },
];

export interface AcoesDaPagina {
  criar: boolean;
  editar: boolean;
  exportar: boolean;
  /** Campos que o perfil não pode mexer (a API devolve 403 se tentar). Lista os que o perfil PODE mexer em `camposRestritos`. */
  camposRestritos: string[];
  colunasVisiveis: string[];
}

/** O que a tela mostra ao perfil. `camposRestritos` = campos de permissão extra que ESTE perfil tem. */
export function acoesDaPagina(perfil: Perfil, p: PaginaCadastros): AcoesDaPagina {
  const edita = p.editar ? pode(perfil, p.editar) : false;
  return {
    criar: edita,
    editar: edita,
    exportar: pode(perfil, 'cadastros.ver'),
    camposRestritos: edita ? (p.restritos ?? []).filter((r) => pode(perfil, r.exige)).map((r) => r.campo) : [],
    colunasVisiveis: p.colunas.filter((c) => !c.exige || pode(perfil, c.exige)).map((c) => c.chave),
  };
}

export interface ConsultaUrl {
  busca?: string;
  /** `id` do último item da página anterior (paginação por cursor, `.coord/contratos/listas.md`). */
  cursor?: string;
  limite?: number;
  inativos?: boolean;
  [filtro: string]: string | number | boolean | undefined;
}

/** Lê a consulta da URL (a URL é a fonte da verdade dos filtros). Só entram os filtros que a página declara. */
export function consultaDaUrl(p: PaginaCadastros, url: URLSearchParams): ConsultaUrl {
  const f = lerFiltros(url, ['busca', 'cursor', 'limite', 'inativos', ...p.filtros]);
  const { busca, cursor, limite, inativos, ...filtros } = f;
  const q: ConsultaUrl = { ...filtros };
  const b = ConsultaLista.shape.busca.safeParse(busca);
  if (b.success && b.data) q.busca = b.data;
  if (cursor) q.cursor = cursor;
  const n = ConsultaPaginada.shape.limite.safeParse(limite);
  if (n.success && n.data !== LIMITE_PADRAO) q.limite = n.data;
  if (inativos === 'true') q.inativos = true;
  return q;
}

/** Colunas do CSV da página: rótulo e valor formatado, só as colunas que o perfil enxerga. */
function colunasCsv(p: PaginaCadastros, visiveis: readonly string[]): ColunaCsv<Record<string, unknown>>[] {
  return p.colunas
    .filter((c) => visiveis.includes(c.chave))
    .map((c) => ({ titulo: c.rotulo, valor: (l) => (c.formatar ? c.formatar(l[c.chave]) : (l[c.chave] as string | number | boolean | null | undefined)) }));
}

/** CSV da lista que o usuário está vendo, com as colunas permitidas ao perfil (a API já filtrou as linhas). */
export function csvDaPagina(p: PaginaCadastros, perfil: Perfil, linhas: readonly Record<string, unknown>[]): string {
  return paraCsv(colunasCsv(p, acoesDaPagina(perfil, p).colunasVisiveis), linhas);
}

/**
 * Páginas de formulário e detalhe (T-0088), fora do menu: abrem pela lista e pelo botão "Novo". O shell soma estas às
 * de `PAGINAS`. O `ver` esconde a página de quem não pode; quem protege a escrita é a API (RN-CORE-02).
 */
export const PAGINAS_EDICAO: readonly PaginaBase[] = [
  { id: 'cliente-novo', menu: 'Clientes', titulo: 'Novo cliente', rota: ROTA_CLIENTE_NOVO, ver: 'cadastros.cliente.editar', ocultaNoMenu: true },
  { id: 'cliente', menu: 'Clientes', titulo: 'Cliente', rota: ROTA_CLIENTE, ver: 'cadastros.ver', ocultaNoMenu: true },
  { id: 'produto-novo', menu: 'Produtos', titulo: 'Novo produto', rota: ROTA_PRODUTO_NOVO, ver: 'cadastros.produto.editar', ocultaNoMenu: true },
  { id: 'produto', menu: 'Produtos', titulo: 'Produto', rota: ROTA_PRODUTO, ver: 'cadastros.ver', ocultaNoMenu: true },
  { id: 'tabela-preco-nova', menu: 'Tabelas de preço', titulo: 'Nova tabela de preço', rota: ROTA_TABELA_PRECO_NOVA, ver: 'cadastros.preco.editar', ocultaNoMenu: true },
  { id: 'tabela-preco', menu: 'Tabelas de preço', titulo: 'Tabela de preço', rota: ROTA_TABELA_PRECO, ver: 'cadastros.ver', ocultaNoMenu: true },
  { id: 'filial-nova', menu: 'Filiais', titulo: 'Nova filial', rota: ROTA_FILIAL_NOVA, ver: 'cadastros.filial.editar', ocultaNoMenu: true },
  { id: 'filial', menu: 'Filiais', titulo: 'Filial', rota: ROTA_FILIAL, ver: 'cadastros.ver', ocultaNoMenu: true },
];
