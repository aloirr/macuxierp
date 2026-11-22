/**
 * Consulta de cadastros para o módulo pedido (T-0013 §3.2, pedido da T-0015). O pedido declara a porta
 * `ConsultaCadastrosPedido` em `modules/pedido/api/portas.ts`; os tipos abaixo são estruturalmente compatíveis com ela,
 * sem o cadastros importar o pedido. Toda consulta roda na transação do chamador (RLS do tenant), em lote, e devolve
 * também o inativo (a decisão é do pedido). O produto sai sem custo (nunca vai ao pedido nem ao FDV).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { Cliente, CondicaoPagamento, Filial, PrecoVigente, Produto, SaldoEstoque } from '../contracts';
import { precosVigentesDe, unicos } from './precos-vigentes';
import type { Repositorios } from './portas';

const CAMPOS_CLIENTE = ['id', 'tipo_pessoa', 'documento', 'razao_social', 'nome_fantasia', 'ind_ie_dest', 'ie', 'limite_credito_centavos', 'condicao_pagamento_id', 'tabela_preco_id', 'filial_id', 'vendedor_id', 'enderecos', 'inativo'] as const;
const CAMPOS_FILIAL = ['id', 'emissora', 'padrao', 'inativo'] as const;
const CAMPOS_PRODUTO = ['id', 'codigo', 'descricao', 'unidade_comercial', 'ean', 'ncm', 'inativo'] as const;

export type ClienteParaPedido = Pick<Cliente, (typeof CAMPOS_CLIENTE)[number]>;
export type FilialParaPedido = Pick<Filial, (typeof CAMPOS_FILIAL)[number]>;
export type ProdutoParaPedido = Pick<Produto, (typeof CAMPOS_PRODUTO)[number]> & { unidades: { unidade: string; fator: number }[] };

/** Copia só as chaves listadas: o que não está na lista (custo, e-mail, contatos) nunca sai. */
function escolher<T extends object, K extends keyof T>(obj: T, campos: readonly K[]): Pick<T, K> {
  const saida = {} as Pick<T, K>;
  for (const k of campos) saida[k] = obj[k];
  return saida;
}

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
      const c = await repositorios(tx).clientes.obter(id);
      return c ? escolher(c, CAMPOS_CLIENTE) : null;
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
