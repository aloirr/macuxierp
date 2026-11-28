/**
 * Páginas auxiliares do BKO (T-0123): estoque, condições de pagamento, equipe e carteira, tabelas oficiais e itens da tabela
 * de preço, descritas como dados tipados (lista pelo SDK, campos, validação e corpo da API). As regras vêm do `domain` e dos
 * schemas de `contracts`; a API revalida (RN-CORE-02) e o shell só desenha. Quantidade em ×10^4 (D11), dinheiro em centavos
 * e desconto em pontos-base (10_000 = 100%): o texto digitado em reais ou percentual vira inteiro aqui, nunca ponto flutuante.
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarQuantidade, interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import {
  CondicaoPagamento, MovimentoEstoque, OficialLinha, PrecoItemEntrada, PrecoLote, SaldoEstoqueItem, TransferenciaCarteira, Uuid, Vendedor, VendedorAtualizacao, VendedorDados,
} from '../contracts';
import { aplicarMovimento, validarLotePreco } from '../domain';
import { camposVisiveis, centavosDoTexto, colunaSituacao, corpoDoPatch, faltandoObrigatorios, opcoes, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';
import { API_FILIAIS } from './filiais';
import { API_PRODUTOS } from './produtos';
import { API_TABELAS_PRECO } from './precos';
import { AGRUPAR_PRAZOS_POR, FORMAS_DO_PRAZO, ROTULO_PRAZO_MEDIO, corpoDoPatchDoPrazo, diasDoPrazo, montarPrazo, prazoMedioNaLista, rotuloDaForma, type ErrosDoPrazo, type FormularioPrazo } from './prazos';

export const ROTA_ESTOQUE = '/cadastros/estoque';
export const ROTA_CONDICOES = '/cadastros/condicoes-pagamento';
export const ROTA_EQUIPE = '/cadastros/equipe';
export const ROTA_OFICIAIS = '/cadastros/oficiais';
export const API_ESTOQUE = '/v1/cadastros/estoque';
export const API_MOVIMENTOS_ESTOQUE = '/v1/cadastros/estoque/movimentos';
export const API_CONDICOES = '/v1/cadastros/condicoes-pagamento';
export const API_VENDEDORES = '/v1/cadastros/vendedores';
export const API_TRANSFERIR_CARTEIRA = '/v1/cadastros/carteira/transferir';
export const API_OFICIAIS = '/v1/cadastros/oficiais';
/** `PUT /v1/cadastros/tabelas-preco/:id/itens` (e o GET da lista dos itens). */
export const apiItensPreco = (tabelaId: string): string => `${API_TABELAS_PRECO}/${tabelaId}/itens`;

// ---- Estoque (RF-CAD-06, RN-CAD-07) ----
export const paginaEstoque = definirPaginaLista({
  id: 'estoque', api: API_ESTOQUE, item: SaldoEstoqueItem, busca: true,
  filtros: { filial_id: Uuid.optional(), produto_id: Uuid.optional() },
  colunas: [
    { id: 'filial_id', titulo: 'Filial', valor: (s) => s.filial_id },
    { id: 'produto_id', titulo: 'Produto', valor: (s) => s.produto_id },
    { id: 'quantidade', titulo: 'Saldo', valor: (s) => formatarQuantidade(s.quantidade) },
  ],
  csv: { arquivo: 'estoque.csv' },
  vazio: { semFiltro: 'Nenhum saldo de estoque.', comFiltro: 'Nenhum saldo com estes filtros.' },
});

const TIPOS_MOVIMENTO = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste (com sinal)' } as const;

export const CAMPOS_MOVIMENTO_ESTOQUE: readonly CampoEdicao[] = [
  { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', obrigatorio: true, fonte: API_FILIAIS, colunas: 4 },
  { nome: 'produto_id', rotulo: 'Produto', tipo: 'cadastro', obrigatorio: true, fonte: API_PRODUTOS, colunas: 4 },
  { nome: 'tipo', rotulo: 'Movimento', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(TIPOS_MOVIMENTO), colunas: 2 },
  { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'texto', obrigatorio: true, colunas: 2 },
  { nome: 'motivo', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true, colunas: 12 },
];
export const camposDoMovimentoEstoque = (perfil: Perfil) => camposVisiveis(CAMPOS_MOVIMENTO_ESTOQUE, perfil, 'criar');

/** RN-CAD-07: quantidade positiva (ajuste: com sinal, não zero); o saldo negativo é da API (depende do saldo e da permissão). */
export function validarMovimentoEstoque(v: Valores, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDoMovimentoEstoque(perfil), v);
  const tipo = (v.tipo ?? '').trim();
  if (!e.tipo && !(tipo in TIPOS_MOVIMENTO)) e.tipo = 'Escolha entrada, saída ou ajuste';
  if (!e.quantidade) {
    const q = interpretarQuantidade(v.quantidade ?? '');
    if (q === null) e.quantidade = 'Informe a quantidade (até 4 casas decimais)';
    else if (!e.tipo) {
      const r = aplicarMovimento({ saldo: Number.MAX_SAFE_INTEGER / 2, tipo: tipo as keyof typeof TIPOS_MOVIMENTO, quantidade: q, podeNegativo: true });
      if (!r.ok) e.quantidade = r.violacao.mensagem;
    }
  }
  return e;
}

/** Corpo do `POST /estoque/movimentos`; `null` se o contrato recusar. A repetição segura é pelo `Idempotency-Key` da tentativa. */
export function corpoMovimentoEstoque(v: Valores): MovimentoEstoque | null {
  const r = MovimentoEstoque.safeParse({
    filial_id: (v.filial_id ?? '').trim(), produto_id: (v.produto_id ?? '').trim(), tipo: (v.tipo ?? '').trim(),
    quantidade: interpretarQuantidade(v.quantidade ?? ''), motivo: (v.motivo ?? '').trim(),
  });
  return r.success ? r.data : null;
}

// ---- Condições de pagamento (RF-CAD-09, RN-CAD-15) ----
export const paginaCondicoes = definirPaginaLista({
  id: 'condicoes-pagamento', api: API_CONDICOES, item: CondicaoPagamento, busca: true, inativos: true,
  colunas: [
    { id: 'codigo', titulo: 'Código', valor: (c) => c.codigo },
    { id: 'descricao', titulo: 'Descrição', valor: (c) => c.descricao },
    { id: 'forma_tpag', titulo: 'Forma de pagamento', valor: (c) => rotuloDaForma(c.forma_tpag) },
    { id: 'prazos_dias', titulo: 'Dias das parcelas', valor: (c) => diasDoPrazo(c.prazos_dias) },
    { id: 'prazo_medio_dias', titulo: ROTULO_PRAZO_MEDIO, valor: (c) => prazoMedioNaLista(c.prazo_medio_dias) },
    colunaSituacao(),
  ],
  csv: { arquivo: 'condicoes-pagamento.csv' },
  vazio: { semFiltro: 'Nenhuma condição de pagamento cadastrada.', comFiltro: 'Nenhuma condição com estes filtros.' },
});
/** A lista das condições se agrupa por este campo (o agrupamento é de `prazos.ts`). */
export const AGRUPAR_CONDICOES_POR = AGRUPAR_PRAZOS_POR;

/** Campos fixos do formulário; as parcelas (dinâmicas) e o "+ Parcela" são de `prazos.ts`. */
export const CAMPOS_CONDICAO: readonly CampoEdicao[] = [
  { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, colunas: 2 },
  { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, colunas: 4 },
  { nome: 'forma_tpag', rotulo: 'Forma de pagamento', tipo: 'selecao', obrigatorio: true, opcoes: FORMAS_DO_PRAZO.map((f) => ({ valor: f.tpag, rotulo: f.rotulo })), colunas: 3 },
  { nome: 'prazo_medio_dias', rotulo: ROTULO_PRAZO_MEDIO, tipo: 'texto', colunas: 3, ajuda: 'Vazio = calculado pelas parcelas.' },
];
export const camposDaCondicao = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_CONDICAO, perfil, modo);

/** RN-CAD-15: mesma regra da API (`validarCondicaoPagamento`) por campo; o corpo só vem sem erro. */
export const validarCondicao = (f: FormularioPrazo): ErrosDoPrazo => montarPrazo(f).erros;
export const corpoCriarCondicao = (f: FormularioPrazo) => montarPrazo(f).corpo ?? null;
/** PATCH só com o que mudou (`corpo` ausente = erro em `erros`; `{}` = nada a enviar). */
export const corpoAlterarCondicao = (f: FormularioPrazo, original: CondicaoPagamento) => corpoDoPatchDoPrazo(f, original);

// ---- Equipe e carteira (RF-CAD-07, D7) ----
export const paginaEquipe = definirPaginaLista({
  id: 'vendedores', api: API_VENDEDORES, item: Vendedor, busca: true, inativos: true,
  filtros: { filial_id: Uuid.optional() },
  colunas: [
    { id: 'codigo', titulo: 'Código', valor: (v) => v.codigo },
    { id: 'nome', titulo: 'Vendedor', valor: (v) => v.nome },
    { id: 'filial_id', titulo: 'Filial', valor: (v) => v.filial_id },
    colunaSituacao(),
  ],
  csv: { arquivo: 'vendedores.csv' },
  vazio: { semFiltro: 'Nenhum vendedor cadastrado.', comFiltro: 'Nenhum vendedor com estes filtros.' },
});

export const CAMPOS_VENDEDOR: readonly CampoEdicao[] = [
  { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, colunas: 2 },
  { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, colunas: 6 },
  { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', obrigatorio: true, fonte: API_FILIAIS, colunas: 4 },
];
export const camposDoVendedor = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_VENDEDOR, perfil, modo);

export function valoresDoVendedor(x: Vendedor): Valores {
  return { codigo: x.codigo, nome: x.nome, filial_id: x.filial_id };
}
export function validarVendedor(v: Valores, modo: Modo, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDoVendedor(perfil, modo), v);
  if (!e.filial_id && !Uuid.safeParse((v.filial_id ?? '').trim()).success) e.filial_id = 'Escolha a filial pela busca';
  return e;
}
const corpoVendedor = (v: Valores): Corpo => ({ codigo: (v.codigo ?? '').trim(), nome: (v.nome ?? '').trim(), filial_id: (v.filial_id ?? '').trim() });
/** Corpo do POST; `null` se o contrato recusar. O vínculo com o usuário do FDV é da carga e da integração, não desta tela. */
export function corpoCriarVendedor(v: Valores): VendedorDados | null {
  const r = VendedorDados.safeParse({ ...corpoVendedor(v), usuario_id: null });
  return r.success ? r.data : null;
}
export function corpoAlterarVendedor(v: Valores, original: Vendedor): Corpo | null {
  return corpoDoPatch(corpoVendedor(v), original as unknown as Record<string, unknown>, VendedorAtualizacao);
}

/** Transferência de carteira: de um vendedor para outro, a carteira inteira ou os clientes escolhidos. */
export const CAMPOS_TRANSFERENCIA: readonly CampoEdicao[] = [
  { nome: 'de', rotulo: 'De (vendedor)', tipo: 'cadastro', obrigatorio: true, fonte: API_VENDEDORES, colunas: 6, exige: 'cadastros.carteira.transferir' },
  { nome: 'para', rotulo: 'Para (vendedor)', tipo: 'cadastro', obrigatorio: true, fonte: API_VENDEDORES, colunas: 6, exige: 'cadastros.carteira.transferir' },
];
export const camposDaTransferencia = (perfil: Perfil) => camposVisiveis(CAMPOS_TRANSFERENCIA, perfil, 'criar');

/** D7: origem e destino diferentes; a carteira de origem (clientes que pertencem a ela) é conferida pela API. */
export function validarTransferencia(v: Valores, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDaTransferencia(perfil), v);
  if (!e.de && !e.para && (v.de ?? '').trim() === (v.para ?? '').trim()) e.para = 'Origem e destino são o mesmo vendedor';
  return e;
}
export function corpoTransferencia(v: Valores, clienteIds?: readonly string[]): TransferenciaCarteira | null {
  const r = TransferenciaCarteira.safeParse({ de: (v.de ?? '').trim(), para: (v.para ?? '').trim(), ...(clienteIds && clienteIds.length > 0 ? { cliente_ids: [...clienteIds] } : {}) });
  return r.success ? r.data : null;
}

// ---- Tabelas oficiais (RF-CAD-10): só leitura ----
type ColunaOficial = { id: string; titulo: string; valor: (o: OficialLinha) => string };
const col = (id: keyof OficialLinha & string, titulo: string): ColunaOficial => ({ id, titulo, valor: (o) => String(o[id] ?? '') });
const VIGENCIA = [col('vigencia_inicio', 'Vigência desde'), col('vigencia_fim', 'Vigência até')];
const oficial = (id: string, tabela: string, arquivo: string, colunas: ColunaOficial[]) =>
  definirPaginaLista({
    id, api: `${API_OFICIAIS}/${tabela}`, item: OficialLinha, busca: true, colunas: [...colunas, ...VIGENCIA], csv: { arquivo },
    vazio: { semFiltro: 'Tabela oficial sem registros vigentes.', comFiltro: 'Nada com estes filtros.' },
  });
export const paginaNcm = oficial('oficiais-ncm', 'ncm', 'ncm.csv', [col('codigo', 'Código'), col('descricao', 'Descrição')]);
export const paginaCest = oficial('oficiais-cest', 'cest', 'cest.csv', [col('codigo', 'Código'), col('descricao', 'Descrição'), col('segmento', 'Segmento')]);
export const paginaCfop = oficial('oficiais-cfop', 'cfop', 'cfop.csv', [col('codigo', 'Código'), col('descricao', 'Descrição')]);
/** Municípios do IBGE (a tabela da API se chama `municipios`; o código é o do IBGE). */
export const paginaIbge = oficial('oficiais-ibge', 'municipios', 'municipios-ibge.csv', [col('codigo', 'Código IBGE'), col('nome', 'Município'), col('uf', 'UF')]);
export const paginasOficiais = { ncm: paginaNcm, cest: paginaCest, cfop: paginaCfop, ibge: paginaIbge } as const;
export type TabelaOficial = keyof typeof paginasOficiais;

// ---- Itens da tabela de preço (RF-CAD-05, RN-CAD-06) ----
export const CAMPOS_ITEM_PRECO: readonly CampoEdicao[] = [
  { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', obrigatorio: true, fonte: API_FILIAIS, colunas: 4 },
  { nome: 'produto_id', rotulo: 'Produto', tipo: 'cadastro', obrigatorio: true, fonte: API_PRODUTOS, colunas: 4 },
  { nome: 'preco_centavos', rotulo: 'Preço (R$)', tipo: 'dinheiro', obrigatorio: true, colunas: 2 },
  { nome: 'desconto_maximo_bp', rotulo: 'Desconto máximo (%)', tipo: 'texto', colunas: 2, ajuda: 'Vazio = 0%.' },
];
export const camposDoItemPreco = (perfil: Perfil) => camposVisiveis(CAMPOS_ITEM_PRECO, perfil, 'criar');

/** Desconto digitado em % ("5,5") em pontos-base (550), inteiro; vazio = 0; fora de 0 a 100% ou ilegível = `null`. */
export function pontosBaseDoTexto(t: string | undefined): number | null {
  const c = centavosDoTexto(t);
  if (c === undefined) return 0;
  return c === null || c > 10_000 ? null : c;
}

export function validarItemPreco(v: Valores, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDoItemPreco(perfil), v);
  for (const k of ['filial_id', 'produto_id'] as const) if (!e[k] && !Uuid.safeParse((v[k] ?? '').trim()).success) e[k] = 'Escolha pela busca';
  if (!e.preco_centavos && typeof centavosDoTexto(v.preco_centavos) !== 'number') e.preco_centavos = 'Informe o preço em reais (ex.: 12,50)';
  if (pontosBaseDoTexto(v.desconto_maximo_bp) === null) e.desconto_maximo_bp = 'Informe de 0 a 100% (até 2 casas)';
  return e;
}

/** Item do lote (sem `external_id`: a chave do kit é da carga, ADR 0010); `null` se o contrato recusar. */
export function corpoItemPreco(v: Valores): PrecoItemEntrada | null {
  const r = PrecoItemEntrada.safeParse({
    filial_id: (v.filial_id ?? '').trim(), produto_id: (v.produto_id ?? '').trim(),
    preco_centavos: centavosDoTexto(v.preco_centavos), desconto_maximo_bp: pontosBaseDoTexto(v.desconto_maximo_bp),
  });
  return r.success ? r.data : null;
}

/**
 * Corpo do `PUT /tabelas-preco/:id/itens`. Mandar o mesmo lote de novo não muda nada (a API só grava o que difere: idempotente).
 * RN-CAD-06: sem produto repetido na mesma filial.
 */
export function corpoLotePreco(linhas: readonly Valores[]): { corpo: PrecoLote | null; erros: Erros } {
  const itens = linhas.map(corpoItemPreco);
  const erros: Erros = {};
  if (itens.some((i) => i === null)) erros.itens = 'Há item com dado inválido';
  else for (const x of validarLotePreco(itens as PrecoItemEntrada[])) erros[x.campo] = x.mensagem;
  if (Object.keys(erros).length > 0) return { corpo: null, erros };
  const r = PrecoLote.safeParse({ itens });
  return r.success ? { corpo: r.data, erros } : { corpo: null, erros: { itens: 'Lote inválido' } };
}
