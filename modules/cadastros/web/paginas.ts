/**
 * Páginas do BKO do módulo cadastros, descritas como dados (rota, menu, API, colunas, filtros e permissões). O shell
 * (apps/web, Next.js) desenha tabela densa, filtros na URL e botão "Exportar CSV" a partir daqui. A permissão na tela
 * só esconde o botão: a proteção real é a da API (RN-CORE-02).
 */
import { ConsultaLista, ConsultaPaginada, LIMITE_PADRAO, lerFiltros, paraCsv, pode, type Acao, type ColunaCsv, type Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDocumento, formatarQuantidade } from './formatar';

export interface ColunaPagina {
  chave: string;
  rotulo: string;
  formatar?: (valor: unknown) => string;
  /** Só quem pode ver o dado (ex.: o custo do produto). */
  exige?: Acao;
}

export interface PaginaCadastros {
  id: string;
  menu: string;
  titulo: string;
  rota: string;
  /** Caminho da lista em `/v1/cadastros`. */
  api: string;
  colunas: readonly ColunaPagina[];
  /** Filtros aceitos na URL, além de `busca`, `cursor`, `limite` e `inativos`. */
  filtros: readonly string[];
  editar?: Acao;
  /** Campos que pedem permissão a mais além de `editar`. */
  restritos?: readonly { campo: string; exige: Acao }[];
}

const ATIVO: ColunaPagina = { chave: 'inativo', rotulo: 'Situação', formatar: (v) => (v ? 'Inativo' : 'Ativo') };
const DOC: ColunaPagina['formatar'] = (v) => formatarDocumento(String(v ?? ''));

export const PAGINAS: readonly PaginaCadastros[] = [
  {
    id: 'clientes', menu: 'Clientes', titulo: 'Clientes', rota: '/cadastros/clientes', api: '/v1/cadastros/clientes', filtros: ['filial_id', 'vendedor_id'],
    colunas: [{ chave: 'documento', rotulo: 'CNPJ/CPF', formatar: DOC }, { chave: 'razao_social', rotulo: 'Razão social' }, { chave: 'nome_fantasia', rotulo: 'Fantasia' }, { chave: 'ind_ie_dest', rotulo: 'Ind. IE' }, { chave: 'limite_credito_centavos', rotulo: 'Limite', formatar: (v) => formatarCentavos(Number(v ?? 0)) }, ATIVO],
    editar: 'cadastros.cliente.editar', restritos: [{ campo: 'limite_credito_centavos', exige: 'cadastros.cliente.credito' }],
  },
  {
    id: 'produtos', menu: 'Produtos', titulo: 'Produtos', rota: '/cadastros/produtos', api: '/v1/cadastros/produtos', filtros: [],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'descricao', rotulo: 'Descrição' }, { chave: 'ncm', rotulo: 'NCM' }, { chave: 'cest', rotulo: 'CEST' }, { chave: 'unidade_comercial', rotulo: 'Un.' }, { chave: 'custo_centavos', rotulo: 'Custo', formatar: (v) => (v === null || v === undefined ? '' : formatarCentavos(Number(v))), exige: 'cadastros.produto.editar' }, ATIVO],
    editar: 'cadastros.produto.editar',
  },
  {
    id: 'tabelas-preco', menu: 'Tabelas de preço', titulo: 'Tabelas de preço', rota: '/cadastros/tabelas-preco', api: '/v1/cadastros/tabelas-preco', filtros: [],
    colunas: [{ chave: 'nome', rotulo: 'Nome' }, { chave: 'vigencia_inicio', rotulo: 'Início' }, { chave: 'vigencia_fim', rotulo: 'Fim' }, { chave: 'padrao', rotulo: 'Padrão', formatar: (v) => (v ? 'Sim' : 'Não') }, ATIVO],
    editar: 'cadastros.preco.editar',
  },
  {
    id: 'estoque', menu: 'Estoque', titulo: 'Estoque', rota: '/cadastros/estoque', api: '/v1/cadastros/estoque', filtros: ['filial_id', 'produto_id'],
    colunas: [{ chave: 'filial_id', rotulo: 'Filial' }, { chave: 'produto_id', rotulo: 'Produto' }, { chave: 'quantidade', rotulo: 'Saldo', formatar: (v) => formatarQuantidade(Number(v ?? 0)) }],
    editar: 'cadastros.estoque.movimentar', restritos: [{ campo: 'saldo_negativo', exige: 'cadastros.estoque.negativo' }],
  },
  {
    id: 'condicoes-pagamento', menu: 'Condições de pagamento', titulo: 'Condições de pagamento', rota: '/cadastros/condicoes-pagamento', api: '/v1/cadastros/condicoes-pagamento', filtros: [],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'descricao', rotulo: 'Descrição' }, { chave: 'forma_tpag', rotulo: 'tPag' }, { chave: 'prazos_dias', rotulo: 'Prazos (dias)', formatar: (v) => (Array.isArray(v) ? v.join('/') : '') }, ATIVO],
    editar: 'cadastros.condicao_pagamento.editar',
  },
  {
    id: 'vendedores', menu: 'Equipe e carteira', titulo: 'Equipe e carteira', rota: '/cadastros/equipe', api: '/v1/cadastros/vendedores', filtros: ['filial_id'],
    colunas: [{ chave: 'codigo', rotulo: 'Código' }, { chave: 'nome', rotulo: 'Vendedor' }, { chave: 'filial_id', rotulo: 'Filial' }, ATIVO],
    editar: 'cadastros.vendedor.editar', restritos: [{ campo: 'carteira', exige: 'cadastros.carteira.transferir' }],
  },
  {
    id: 'filiais', menu: 'Filiais', titulo: 'Filiais', rota: '/cadastros/filiais', api: '/v1/cadastros/filiais', filtros: [],
    colunas: [{ chave: 'cnpj', rotulo: 'CNPJ', formatar: DOC }, { chave: 'razao_social', rotulo: 'Razão social' }, { chave: 'ie', rotulo: 'IE' }, { chave: 'crt', rotulo: 'CRT' }, { chave: 'padrao', rotulo: 'Padrão', formatar: (v) => (v ? 'Sim' : 'Não') }, { chave: 'nfe_serie', rotulo: 'Série NF-e' }, ATIVO],
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
