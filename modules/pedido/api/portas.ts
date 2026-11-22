/**
 * Portas do plugin pedido (T-0013 §3.2, §4.2 e §8.1). O pedido não lê o schema do `cadastros` nem do faturamento:
 * recebe as consultas por porta, na transação do chamador (RLS do tenant). O adaptador SQL (`sql.ts`) roda no schema
 * `pedido`; o dublê em memória (`memoria.ts`) serve aos testes de rota.
 */
import type { Pagina, Transacao } from '@macuxierp/platform-sdk';
import type { z } from 'zod';
import type { CondicaoPagamento, Filial, PrecoVigente, SaldoEstoque } from '@macuxierp/cadastros/contracts';
import type {
  ClienteParaPedido, ClienteRetrato, DecisaoPedido, EnderecoEntrega, Frete, HistoricoPedido, MotivoCodigo, OrigemPedido,
  Pendencia, ProdutoParaPedido, ProdutoRetrato, StatusPedido,
} from '../contracts';
import type { ItemListaPedido, paginaPedidos } from '../web/paginas';

/** Consulta de cadastros que o `cadastros/api` implementa (`criarConsultaParaPedido`) e a API e o worker ligam. */
export interface ConsultaCadastrosPedido {
  cliente(tx: Transacao, id: string): Promise<ClienteParaPedido | null>;
  filial(tx: Transacao, id: string): Promise<Pick<Filial, 'id' | 'emissora' | 'padrao' | 'inativo'> | null>;
  filialPadrao(tx: Transacao): Promise<string | null>;
  produtos(tx: Transacao, ids: readonly string[]): Promise<ProdutoParaPedido[]>;
  /** Tabela de preço padrão vigente na data (`AAAA-MM-DD`). */
  tabelaPadrao(tx: Transacao, data: string): Promise<string | null>;
  precosVigentes(tx: Transacao, c: { tabela_preco_id: string; filial_id: string; produto_ids: readonly string[]; data: string }): Promise<PrecoVigente[]>;
  saldos(tx: Transacao, filial_id: string, produto_ids: readonly string[]): Promise<SaldoEstoque[]>;
  condicao(tx: Transacao, id: string): Promise<CondicaoPagamento | null>;
  /** Filtro "própria carteira" do vendedor: o vendedor ligado ao usuário. */
  vendedorDoUsuario(tx: Transacao, usuario_id: string): Promise<string | null>;
}

/** P4: saldo de títulos abertos do cliente. F3 = 0; o faturamento entrega na F4. */
export interface ConsultaTitulosPedido {
  saldoAbertoCliente(tx: Transacao, cliente_id: string): Promise<number>;
}

/** Porta inversa da F4 (P-2): há nota em autorização para o pedido? F3 = false. */
export interface NotaEmAberto {
  temNotaEmAutorizacao(tx: Transacao, pedido_id: string): Promise<boolean>;
}

/** Log sem dado pessoal (regra 8): só `tenant_id`, `modulo`, `pedido_id`, status e códigos. O pino satisfaz. */
export interface LogPedido {
  info(dados: Record<string, unknown>, mensagem: string): void;
  warn(dados: Record<string, unknown>, mensagem: string): void;
}

// ---- Linhas do schema pedido ----
export interface ItemGravado {
  id: string;
  sequencia: number;
  produto_id: string;
  produto_retrato: ProdutoRetrato;
  /** Qtd4. */
  quantidade: number;
  unidade_venda: string | null;
  fator_venda: number | null;
  quantidade_venda: number | null;
  preco_unitario_centavos: number;
  preco_tabela_centavos: number | null;
  desconto_maximo_bp: number | null;
  desconto_centavos: number;
  total_centavos: number;
  total_informado_centavos: number | null;
  quantidade_faturada: number;
  aplicacao: string | null;
}

export interface PedidoGravado {
  id: string;
  numero: number;
  origem: OrigemPedido;
  external_id: string | null;
  status: StatusPedido;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  condicao_pagamento_id: string | null;
  /** Pedido fora do crédito do cliente (`foraDoCredito`, RN-PED-04), gravado na criação e na aprovação. */
  a_vista: boolean;
  tabela_preco_id: string | null;
  cliente_retrato: ClienteRetrato;
  endereco_entrega: EnderecoEntrega | null;
  frete: Frete | null;
  /** UTC, ISO 8601 com ms. */
  emitido_em: string;
  aprovado_origem_em: string | null;
  observacao: string | null;
  total_centavos: number;
  total_informado_centavos: number | null;
  valor_faturado_centavos: number;
  pendencias: Pendencia[];
  validado_em: string | null;
  criado_por: string | null;
  /** Token do `If-Match` (ms, estritamente crescente por linha: migração 0006). */
  updated_at: string;
  itens: ItemGravado[];
}

export type NovoItem = Omit<ItemGravado, 'id' | 'quantidade_faturada'>;
export type NovoPedido = Omit<PedidoGravado, 'numero' | 'status' | 'updated_at' | 'itens' | 'valor_faturado_centavos'> & { itens: NovoItem[] };

export interface DadosCabecalho {
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  condicao_pagamento_id: string | null;
  a_vista: boolean;
  tabela_preco_id: string | null;
  cliente_retrato: ClienteRetrato;
  endereco_entrega: EnderecoEntrega | null;
  observacao: string | null;
  total_centavos: number;
}

export interface NovoEvento {
  pedido_id: string;
  de: StatusPedido | null;
  para: StatusPedido;
  ator_tipo: 'usuario' | 'sistema';
  ator_id: string | null;
  motivo_codigo: MotivoCodigo | null;
  motivo_texto: string | null;
  pendencias: Pendencia[] | null;
  evento_id: string | null;
  ocorrido_em: Date;
}

export interface NovaAprovacao {
  pedido_id: string;
  decisao: 'aprovado' | 'recusado';
  automatica: boolean;
  decidido_por: string | null;
  perfil: string | null;
  pendencias_aceitas: Pendencia[];
  justificativa: string | null;
  motivo_codigo: MotivoCodigo | null;
  motivo_texto: string | null;
  decidido_em: Date;
}

/** Filtros da lista: o que o descritor `paginaPedidos` aceita na URL, mais o documento (só o CSV de quem pode vê-lo). */
export type FiltroPedidos = Partial<z.output<typeof paginaPedidos.consulta>> & { limite: number; comDocumento?: boolean };

/** Linha da lista e do CSV: a do descritor (`cliente_documento` só vem para quem pode ver o documento). */
export type LinhaLista = ItemListaPedido;

/** O que a API precisa do schema `pedido`, na transação do tenant. O adaptador SQL toma os travamentos. */
export interface RepoPedidos {
  tenantId(): Promise<string>;
  /** `pg_advisory_xact_lock` por (tenant, cliente): crédito e criação serializam por cliente (T-0013 §2). */
  travarCliente(chave: bigint): Promise<void>;
  /** `UPDATE numeracao SET proximo = proximo + 1 RETURNING` (T-0013 §4.4). */
  proximoNumero(): Promise<number>;
  /** Cria em `recebido`; `false` = o `external_id` já existia (RN-PED-01). */
  inserir(id: string, numero: number, p: NovoPedido): Promise<boolean>;
  porExternalId(externalId: string): Promise<PedidoGravado | null>;
  obter(id: string): Promise<PedidoGravado | null>;
  /** `SELECT … FOR UPDATE`: toda transição passa por aqui. */
  obterParaAtualizar(id: string): Promise<PedidoGravado | null>;
  /** Transição pelo gatilho `pedido.validar_status`: transição fora da tabela vira 422 `RN-PED-02` com `possiveis`. */
  atualizarStatus(id: string, status: StatusPedido, pendencias: readonly Pendencia[], validadoEm: Date | null): Promise<void>;
  /** Grava `a_vista` (fora do crédito) na aprovação, com a condição lida naquele momento. */
  atualizarAVista(id: string, aVista: boolean): Promise<void>;
  atualizarPendencias(id: string, pendencias: readonly Pendencia[], validadoEm: Date): Promise<void>;
  atualizarCabecalho(id: string, d: DadosCabecalho): Promise<void>;
  /** Edição do manual: reaproveita o item do mesmo produto, retira o que sobrou (`deleted_at`) e cria os novos. */
  substituirItens(pedidoId: string, itens: readonly NovoItem[]): Promise<void>;
  /** Preço de tabela e desconto máximo da última avaliação, por sequência. */
  atualizarPrecosDeTabela(pedidoId: string, linhas: readonly { sequencia: number; preco_tabela_centavos: number | null; desconto_maximo_bp: number | null }[]): Promise<void>;
  registrarEvento(e: NovoEvento): Promise<void>;
  /**
   * Nota autorizada aplicada (T-0015): grava `quantidade_faturada` por sequência, `valor_faturado_centavos` e o status, sem tocar
   * em pendências. Só o worker tem o GRANT dessas colunas; o gatilho `validar_status` valida a transição.
   */
  aplicarFaturamento(id: string, itens: readonly { sequencia: number; quantidade_faturada: number }[], valorFaturadoCentavos: number, status: StatusPedido): Promise<void>;
  /** Já há histórico do pedido com este `evento_id` (idempotência do consumidor de nota). */
  eventoRegistrado(pedidoId: string, eventoId: string): Promise<boolean>;
  registrarAprovacao(a: NovaAprovacao): Promise<void>;
  historico(pedidoId: string): Promise<HistoricoPedido[]>;
  decisao(pedidoId: string): Promise<DecisaoPedido | null>;
  listar(f: FiltroPedidos): Promise<Pagina<LinhaLista>>;
  /** Cada linha do CSV, sem cursor, até `maximo`. */
  listarTodos(f: Omit<FiltroPedidos, 'limite' | 'cursor'>, maximo: number): Promise<LinhaLista[]>;
  compromissoCredito(clienteId: string, exceto: string | null): Promise<number>;
  compromissoEstoque(filialId: string, produtoIds: readonly string[], exceto: string | null): Promise<{ produto_id: string; quantidade: number }[]>;
}

export interface Dependencias {
  repositorios(tx: Transacao): RepoPedidos;
  cadastros: ConsultaCadastrosPedido;
  titulos: ConsultaTitulosPedido;
  notas: NotaEmAberto;
  log?: LogPedido;
}

export const semNotaEmAberto: NotaEmAberto = { temNotaEmAutorizacao: async () => false };
export const semTitulos: ConsultaTitulosPedido = { saldoAbertoCliente: async () => 0 };
