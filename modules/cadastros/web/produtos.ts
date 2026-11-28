/**
 * Produto no BKO (RF-CAD-04, T-0088): lista pelo SDK e formulário de criação e edição. O formato do NCM e do CEST é conferido
 * aqui; a existência e a vigência (RN-CAD-04, tabelas oficiais) são da API, que devolve o 422 por campo (`errosDaApi`).
 * O custo só vai a quem edita produto e nunca ao FDV.
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarValorCentavos } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { Ean, Produto, ProdutoAtualizacao, ProdutoDados } from '../contracts';
import { formatarNcm } from '../domain';
import { camposVisiveis, centavosDoTexto, corpoDoPatch, faltandoObrigatorios, simNao, colunaSituacao, soDigitos, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_PRODUTOS = '/cadastros/produtos';
export const ROTA_PRODUTO_NOVO = '/cadastros/produtos/novo';
export const ROTA_PRODUTO = '/cadastros/produtos/:id';
export const API_PRODUTOS = '/v1/cadastros/produtos';

export type ProdutoResumo = Produto;

export const paginaProdutos = definirPaginaLista({
  id: 'produtos', api: API_PRODUTOS, item: Produto, busca: true, inativos: true,
  colunas: [
    { id: 'codigo', titulo: 'Código', valor: (p) => p.codigo },
    { id: 'descricao', titulo: 'Descrição', valor: (p) => p.descricao },
    { id: 'ncm', titulo: 'NCM', valor: (p) => formatarNcm(p.ncm) },
    { id: 'cest', titulo: 'CEST', valor: (p) => p.cest ?? '' },
    { id: 'unidade_comercial', titulo: 'Un.', valor: (p) => p.unidade_comercial },
    { id: 'producao_propria', titulo: 'Fabricado pela empresa', valor: (p) => simNao(p.producao_propria) },
    { id: 'custo_centavos', titulo: 'Custo', valor: (p) => (p.custo_centavos === null ? '' : formatarCentavos(p.custo_centavos)), exige: 'cadastros.produto.editar' },
    colunaSituacao(),
  ],
  csv: { arquivo: 'produtos.csv' },
  vazio: { semFiltro: 'Nenhum produto cadastrado.', comFiltro: 'Nenhum produto com estes filtros.' },
});

const ORIGENS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

export const CAMPOS_PRODUTO: readonly CampoEdicao[] = [
  { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true },
  { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true },
  { nome: 'ncm', rotulo: 'NCM', tipo: 'texto', obrigatorio: true, ajuda: '8 números, vigente na tabela NCM.' },
  { nome: 'cest', rotulo: 'CEST', tipo: 'texto', ajuda: 'Obrigatório quando o produto tem substituição tributária.' },
  { nome: 'unidade_comercial', rotulo: 'Unidade comercial', tipo: 'texto', obrigatorio: true },
  { nome: 'ean', rotulo: 'EAN/GTIN', tipo: 'texto', ajuda: '8, 12, 13 ou 14 números, ou "SEM GTIN".' },
  { nome: 'marca', rotulo: 'Marca', tipo: 'texto' },
  { nome: 'origem', rotulo: 'Origem da mercadoria', tipo: 'selecao', obrigatorio: true, opcoes: ORIGENS.map((o) => ({ valor: o, rotulo: o })) },
  { nome: 'grupo_tributacao', rotulo: 'Grupo de tributação', tipo: 'texto', obrigatorio: true },
  { nome: 'producao_propria', rotulo: 'Fabricado pela empresa', tipo: 'booleano' },
  { nome: 'custo_centavos', rotulo: 'Custo (R$)', tipo: 'dinheiro', exige: 'cadastros.produto.editar' },
];

export const camposDoProduto = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_PRODUTO, perfil, modo);

export function valoresDoProduto(p: ProdutoResumo): Valores {
  return {
    codigo: p.codigo, descricao: p.descricao, ncm: p.ncm, cest: p.cest ?? '', unidade_comercial: p.unidade_comercial, ean: p.ean ?? '', marca: p.marca ?? '', origem: p.origem,
    grupo_tributacao: p.grupo_tributacao, producao_propria: p.producao_propria ? 'true' : 'false', custo_centavos: p.custo_centavos == null ? '' : formatarValorCentavos(p.custo_centavos),
  };
}

export function validarProduto(v: Valores, modo: Modo, perfil: Perfil): Erros {
  const campos = camposDoProduto(perfil, modo);
  const e = faltandoObrigatorios(campos, v);
  if (!e.ncm && !ProdutoDados.shape.ncm.safeParse(soDigitos(v.ncm)).success) e.ncm = 'Informe o NCM completo, com 8 dígitos';
  if (vazioParaNulo(v.cest) !== null && !ProdutoDados.shape.cest.safeParse(soDigitos(v.cest)).success) e.cest = 'Informe o CEST completo, com 7 dígitos';
  const ean = vazioParaNulo(v.ean);
  if (ean !== null && !Ean.safeParse(ean).success) e.ean = 'Informe o código de barras completo ou "SEM GTIN"';
  if (campos.some((c) => c.nome === 'custo_centavos') && centavosDoTexto(v.custo_centavos) === null) e.custo_centavos = 'Informe o custo em reais, como 12,50';
  return e;
}

function corpoComum(v: Valores, perfil: Perfil, modo: Modo): Corpo {
  const c: Corpo = {
    codigo: (v.codigo ?? '').trim(), descricao: (v.descricao ?? '').trim(), ncm: soDigitos(v.ncm), cest: vazioParaNulo(soDigitos(v.cest)), unidade_comercial: (v.unidade_comercial ?? '').trim(),
    ean: vazioParaNulo(v.ean), marca: vazioParaNulo(v.marca), origem: v.origem, grupo_tributacao: (v.grupo_tributacao ?? '').trim(), producao_propria: v.producao_propria === 'true',
  };
  if (camposDoProduto(perfil, modo).some((x) => x.nome === 'custo_centavos')) c.custo_centavos = centavosDoTexto(v.custo_centavos) ?? null;
  return c;
}

/** Corpo do POST; a unidade tributável nasce igual à comercial (fator 1), e a tela de unidades ajusta depois. */
export function corpoCriarProduto(v: Valores, perfil: Perfil): ProdutoDados | null {
  const c = corpoComum(v, perfil, 'criar');
  const r = ProdutoDados.safeParse({ ...c, unidade_tributavel: c.unidade_comercial });
  return r.success ? r.data : null;
}

/** Corpo do PATCH com o que mudou; sem mudança, `null`. */
export function corpoAlterarProduto(v: Valores, original: ProdutoResumo, perfil: Perfil): Corpo | null {
  return corpoDoPatch(corpoComum(v, perfil, 'editar'), { ...original, producao_propria: original.producao_propria === true }, ProdutoAtualizacao);
}
