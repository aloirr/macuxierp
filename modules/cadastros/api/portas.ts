/**
 * Portas do plugin cadastros: o que as rotas precisam do banco, das fontes externas e do core. O adaptador SQL
 * (`sql.ts`) roda na transação do tenant (RLS); o adaptador em memória (`memoria.ts`) serve aos testes de rota.
 */
import type { Pagina, Transacao } from '@macuxierp/platform-sdk';
import type {
  Cliente, ClienteDados, Contato, ContatoItem, CondicaoPagamento, CondicaoPagamentoDados, EnderecoCliente,
  EnderecoClienteItem, Filial, FilialDados, ListaConsulta, MovimentoEstoque, OficialConsulta, PrecoItem, PrecoItemConsulta, PrecoItemLista, Produto,
  ProdutoDados, SaldoEstoque, TabelaPreco, TabelaPrecoDados, UnidadeDados, UnidadeItem, Vendedor, VendedorDados,
} from '../contracts';

export type FiltroLista = ListaConsulta & {
  /** Escopo da carteira do vendedor (D7): só clientes destes vendedores. */
  vendedor_ids?: readonly string[];
};

export interface RepoSimples<E extends { id: string }, D> {
  listar(q: FiltroLista): Promise<Pagina<E>>;
  /** Traz também o inativo (RN-CAD-08). */
  obter(id: string): Promise<E | null>;
  porExternalId(externalId: string): Promise<E | null>;
  /** Lança `ErroApi` 409 se violar unicidade (CNPJ, documento, código). */
  inserir(dados: D): Promise<E>;
  atualizar(id: string, parcial: Partial<D>): Promise<E | null>;
  /** Inativa (`deleted_at`), nunca apaga (RN-CAD-08). */
  inativar(id: string): Promise<E | null>;
  /** Dos ids pedidos, os que existem e estão ativos (uma consulta só; o lote de preços confere 5.000 produtos). */
  idsAtivos(ids: readonly string[]): Promise<Set<string>>;
}

export interface RepoFilho<E extends { id: string }, D> {
  listar(paiId: string): Promise<E[]>;
  obter(paiId: string, id: string): Promise<E | null>;
  inserir(paiId: string, dados: D): Promise<E>;
  atualizar(paiId: string, id: string, parcial: Partial<D>): Promise<E | null>;
  inativar(paiId: string, id: string): Promise<E | null>;
}

export interface RepoFiliais extends RepoSimples<Filial, FilialDados> {
  padrao(): Promise<Filial | null>;
  /** Tira a marca de padrão das outras (só uma por tenant). */
  desmarcarPadrao(exceto: string | null): Promise<void>;
}

export interface RepoClientes extends RepoSimples<Cliente, ClienteDados> {
  enderecos: RepoFilho<EnderecoClienteItem, EnderecoCliente>;
  contatos: RepoFilho<ContatoItem, Contato>;
  idsDaCarteira(vendedorId: string): Promise<string[]>;
  /** Move os clientes para o vendedor de destino (D7). */
  transferir(para: string, clienteIds: readonly string[]): Promise<void>;
}

export interface RepoProdutos extends RepoSimples<Produto, ProdutoDados> {
  unidades: RepoFilho<UnidadeItem, UnidadeDados>;
}

export interface RepoTabelasPreco extends RepoSimples<TabelaPreco, TabelaPrecoDados> {
  desmarcarPadrao(exceto: string | null): Promise<void>;
  itens(tabelaId: string, q: PrecoItemConsulta): Promise<Pagina<PrecoItemLista>>;
  /** Itens da tabela de um produto nas filiais pedidas (preço vigente, RN-CAD-06). */
  itensDoProduto(tabelaId: string, produtoId: string, filialIds: readonly string[]): Promise<PrecoItem[]>;
  /** Insere ou atualiza o lote (único por tabela, filial e produto). Devolve só o que mudou. */
  gravarLote(tabelaId: string, itens: readonly Omit<PrecoItem, 'tabela_preco_id'>[]): Promise<PrecoItem[]>;
}

export interface MovimentoGravado extends MovimentoEstoque {
  usuario_id: string;
}

export interface RepoEstoque {
  saldos(q: { filial_id?: string; produto_id?: string }): Promise<SaldoEstoque[]>;
  /** Lê o saldo travando a linha (`FOR UPDATE`): dois movimentos simultâneos não furam a RN-CAD-07. */
  saldoParaAtualizar(filialId: string, produtoId: string): Promise<number>;
  gravarMovimento(mov: MovimentoGravado, saldoNovo: number): Promise<{ id: string }>;
  movimentoPorExternalId(externalId: string): Promise<{ id: string } | null>;
}

export interface RepoVendedores extends RepoSimples<Vendedor, VendedorDados> {
  idsDoUsuario(usuarioId: string): Promise<string[]>;
}

export type TipoConsulta = 'cnpj' | 'cep' | 'ie';
export interface ConsultaGravada {
  tipo: TipoConsulta;
  chave: string;
  resposta: Record<string, unknown>;
  fonte: string;
  consultado_em: Date;
  expira_em: Date;
  external_id: string | null;
}
export interface RepoConsultaExterna {
  obter(tipo: TipoConsulta, chave: string): Promise<ConsultaGravada | null>;
  porExternalId(tipo: TipoConsulta, externalId: string): Promise<ConsultaGravada | null>;
  /** Upsert por tipo e chave. */
  gravar(c: ConsultaGravada): Promise<void>;
}

export interface RepoOficiais {
  listar(tabela: (typeof import('../contracts').TABELAS_OFICIAIS)[number], q: OficialConsulta): Promise<Pagina<Record<string, unknown>>>;
  ncmVigente(ncm: string, data: string): Promise<boolean>;
  /** O NCM tem CEST vigente em `cest_ncm` (segmento com substituição tributária). */
  ncmExigeCest(ncm: string, data: string): Promise<boolean>;
  cestVigente(cest: string, data: string): Promise<boolean>;
  cestCombinaComNcm(cest: string, ncm: string, data: string): Promise<boolean>;
}

export interface Repositorios {
  filiais: RepoFiliais;
  clientes: RepoClientes;
  produtos: RepoProdutos;
  tabelasPreco: RepoTabelasPreco;
  estoque: RepoEstoque;
  condicoesPagamento: RepoSimples<CondicaoPagamento, CondicaoPagamentoDados>;
  vendedores: RepoVendedores;
  consultaExterna: RepoConsultaExterna;
  oficiais: RepoOficiais;
}

/** Fonte externa de consulta (BrasilAPI, ViaCEP, ...). `null` = não achou; lançar = falhou (tempo, rede, 5xx). */
export interface FonteExterna<T> {
  id: 'brasilapi' | 'viacep' | 'receita-aberta';
  consultar(chave: string, opcoes: { timeoutMs: number }): Promise<T | null>;
}

export interface Fontes {
  /** Principal primeiro; a de reserva só entra se a principal falhar. */
  cnpj: readonly FonteExterna<Record<string, unknown>>[];
  cep: readonly FonteExterna<Record<string, unknown>>[];
}

/**
 * A1 da filial (core): o cadastros não lê `core.certificado`. O core entrega esta porta (pedido registrado na T-0007);
 * enquanto ela não existe, o adaptador padrão responde "sem certificado" e a consulta de IE devolve 422 RN-CORE-06.
 */
export interface PortaCertificados {
  filialTemA1Valido(tx: Transacao, filialId: string, agora: Date): Promise<boolean>;
}

export interface Dependencias {
  repositorios(tx: Transacao): Repositorios;
  fontes: Fontes;
  certificados: PortaCertificados;
}
