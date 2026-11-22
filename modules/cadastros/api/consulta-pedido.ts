/**
 * Consulta de cadastros para o módulo pedido (T-0013 §3.2, pedido da T-0015). O pedido declara a porta
 * `ConsultaCadastrosPedido` em `modules/pedido/api/portas.ts`; os tipos abaixo são estruturalmente compatíveis com ela,
 * sem o cadastros importar o pedido. Toda consulta roda na transação do chamador (RLS do tenant), em lote, e devolve
 * também o inativo (a decisão é do pedido). O produto sai sem custo (nunca vai ao pedido nem ao FDV).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { EnderecoClienteItem, type Cliente, type CondicaoPagamento, Filial, PrecoVigente, Produto, SaldoEstoque } from '../contracts';
import { comNomeMunicipio } from './enderecos';
import { precosVigentesDe, unicos } from './precos-vigentes';
import type { Repositorios } from './portas';
import { escolher } from './util';

const CAMPOS_CLIENTE = ['id', 'tipo_pessoa', 'documento', 'razao_social', 'nome_fantasia', 'ind_ie_dest', 'ie', 'limite_credito_centavos', 'condicao_pagamento_id', 'tabela_preco_id', 'filial_id', 'vendedor_id', 'enderecos', 'inativo'] as const;
const CAMPOS_FILIAL = ['id', 'emissora', 'padrao', 'inativo'] as const;
const CAMPOS_ENDERECO = Object.keys(EnderecoClienteItem.shape) as (keyof EnderecoClienteItem)[];
const CAMPOS_PRODUTO = ['id', 'codigo', 'descricao', 'unidade_comercial', 'ean', 'ncm', 'origem', 'inativo'] as const;

/** Endereço com o `id` e o nome do IBGE (`null` se o código não está na tabela oficial), como no evento C-1/C-3. */
export type EnderecoParaPedido = EnderecoClienteItem & { municipio_nome: string | null };
export type ClienteParaPedido = Omit<Pick<Cliente, (typeof CAMPOS_CLIENTE)[number]>, 'enderecos'> & { enderecos: EnderecoParaPedido[] };
export type FilialParaPedido = Pick<Filial, (typeof CAMPOS_FILIAL)[number]>;
export type ProdutoParaPedido = Pick<Produto, (typeof CAMPOS_PRODUTO)[number]> & { unidades: { unidade: string; fator: number }[] };

export interface ConsultaCadastrosParaPedido {
  cliente(tx: Transacao, id: string): Promise<ClienteParaPedido | null>;
  filial(tx: Transacao, id: string): Promise<FilialParaPedido | null>;
  filialPadrao(tx: Transacao): Promise<string | null>;
  produtos(tx: Transacao, ids: readonly string[]): Promise<ProdutoParaPedido[]>;
  tabelaPadrao(tx: Transacao, data: string): Promise<string | null>;
  precosVigentes(tx: Transacao, c: { tabela_preco_id: string; filial_id: string; produto_ids: readonly string[]; data: string }): Promise<PrecoVigente[]>;
  saldos(tx: Transacao, filial_id: string, produto_ids: readonly string[]): Promise<SaldoEstoque[]>;
  condicao(tx: Transacao, id: string): Promise<CondicaoPagamento | null>;
  vendedorDoUsuario(tx: Transacao, usuario_id: string): Promise<string | null>;
}

export function criarConsultaParaPedido(repositorios: (tx: Transacao) => Repositorios): ConsultaCadastrosParaPedido {
  return {
    async cliente(tx, id) {
      const r = repositorios(tx);
      const c = await r.clientes.obter(id);
      if (!c) return null;
      // Cópia tipada só das chaves do item, sem validar de novo: dado antigo não derruba a consulta com 500.
      const itens = ((c.enderecos ?? []) as EnderecoClienteItem[]).map((e) => escolher(e, CAMPOS_ENDERECO));
      return { ...escolher(c, CAMPOS_CLIENTE), enderecos: await comNomeMunicipio(r, itens) };
    },
    async filial(tx, id) {
      const f = await repositorios(tx).filiais.obter(id);
      return f ? escolher(f, CAMPOS_FILIAL) : null;
    },
    async filialPadrao(tx) {
      return (await repositorios(tx).filiais.padrao())?.id ?? null;
    },
    async produtos(tx, ids) {
      const r = repositorios(tx);
      const lista = unicos(ids);
      const [produtos, unidades] = await Promise.all([r.produtos.porIds(lista), r.produtos.unidadesDe(lista)]);
      return produtos.map((p) => ({
        ...escolher(p, CAMPOS_PRODUTO),
        unidades: unidades.filter((u) => u.produto_id === p.id).map(({ unidade, fator }) => ({ unidade, fator })),
      }));
    },
    async tabelaPadrao(tx, data) {
      return (await repositorios(tx).tabelasPreco.padraoEm(data))?.id ?? null;
    },
    /** RN-CAD-06: preço da filial; sem item nela, o da filial padrão. Tabela inexistente, inativa ou fora da vigência, ou produto sem preço: fica fora do resultado. */
    async precosVigentes(tx, c) {
      const res = await precosVigentesDe(repositorios(tx), c);
      return (res ?? []).flatMap((p) => (p.ok ? [p.preco] : []));
    },
    saldos: (tx, filial_id, produto_ids) => repositorios(tx).estoque.saldosDe(filial_id, unicos(produto_ids)),
    condicao: async (tx, id) => (await repositorios(tx).condicoesPagamento.obter(id)) ?? null,
    async vendedorDoUsuario(tx, usuario_id) {
      return (await repositorios(tx).vendedores.idsDoUsuario(usuario_id))[0] ?? null;
    },
  };
}
