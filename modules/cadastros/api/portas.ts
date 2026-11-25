/**
 * Portas do plugin cadastros: o que as rotas precisam do banco, das fontes externas e do core. O adaptador SQL
 * (`sql.ts`) roda na transação do tenant (RLS); o adaptador em memória (`memoria.ts`) serve aos testes de rota.
 */
import type { Pagina, Transacao } from '@macuxierp/platform-sdk';
import type {
  Cliente, ClienteDados, Contato, ContatoItem, CondicaoPagamento, CondicaoPagamentoDados, EnderecoCliente,
  EnderecoClienteItem, Filial, FilialDados, ListaConsulta, MovimentoEstoque, OficialConsulta, PrecoItem, PrecoItemComChave, PrecoItemConsulta, PrecoItemLista, Produto,
  ProdutoDados, SaldoEstoque, SaldoEstoqueItem, EstoqueConsulta, TabelaPreco, TabelaPrecoDados, UnidadeDados, UnidadeItem, Vendedor, VendedorDados,
} from '../contracts';
import type { ConsultaUsoCadastros } from './zeragem-portas';

export type FiltroLista = ListaConsulta & {
  /** Escopo da carteira do vendedor (D7): só clientes destes vendedores. */
  vendedor_ids?: readonly string[];
};

export interface RepoSimples<E extends { id: string }, D> {
  listar(q: FiltroLista): Promise<Pagina<E>>;
  /** Traz também o inativo (RN-CAD-08). */
  obter(id: string): Promise<E | null>;
  porExternalId(externalId: string): Promise<E | null>;
  /** Chave natural da carga (D4): `cnpj`, `documento` ou `codigo`; traz também o inativo. */
  porCampo(campo: 'cnpj' | 'documento' | 'codigo', valor: string): Promise<E | null>;
  /** Reativa o cadastro inativado (`deleted_at = NULL`; carga, D6). */
  reativar(id: string): Promise<E | null>;
  /** Lança `ErroApi` 409 se violar unicidade (CNPJ, documento, código). */
  inserir(dados: D): Promise<E>;
  atualizar(id: string, parcial: Partial<D>): Promise<E | null>;
  /** Inativa (`deleted_at`), nunca apaga (RN-CAD-08). */
  inativar(id: string): Promise<E | null>;
  /** Página por cursor (id crescente), inativos incluídos: a carga inicial (C-4). */
  paginaPorCursor(apos: string | null, limite: number): Promise<E[]>;
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
  /** Endereço principal do cliente para a nota, inclusive o inativado (Substituir tudo, RN-CAD-10): o ativo, ou o mais recente. `null` sem principal. */
  principalParaNota(clienteId: string): Promise<EnderecoClienteItem | null>;
  /** Move os clientes para o vendedor de destino (D7). */
  transferir(para: string, clienteIds: readonly string[]): Promise<void>;
}

export interface RepoProdutos extends RepoSimples<Produto, ProdutoDados> {
  unidades: RepoFilho<UnidadeItem, UnidadeDados>;
  /** Em lote, inclusive inativos (consulta do pedido). */
  porIds(ids: readonly string[]): Promise<Produto[]>;
  /** Unidades alternativas ativas dos produtos, em lote. */
  unidadesDe(ids: readonly string[]): Promise<{ produto_id: string; unidade: string; fator: number }[]>;
}

export interface RepoTabelasPreco extends RepoSimples<TabelaPreco, TabelaPrecoDados> {
  desmarcarPadrao(exceto: string | null): Promise<void>;
  itens(tabelaId: string, q: PrecoItemConsulta): Promise<Pagina<PrecoItemLista>>;
  /** Itens da tabela dos produtos nas filiais pedidas (preço vigente, RN-CAD-06). */
  itensDosProdutos(tabelaId: string, produtoIds: readonly string[], filialIds: readonly string[]): Promise<PrecoItem[]>;
  /** Tabela padrão ativa e vigente na data (AAAA-MM-DD). */
  padraoEm(data: string): Promise<TabelaPreco | null>;
  /** Insere ou atualiza o lote (único por tabela, filial e produto). Devolve só o que mudou. */
  gravarLote(tabelaId: string, itens: readonly Omit<PrecoItem, 'tabela_preco_id'>[]): Promise<PrecoItem[]>;
}

export interface MovimentoGravado extends MovimentoEstoque {
  /** Nulo quando o movimento nasce de evento (a nota), sem usuário. */
  usuario_id: string | null;
  /** Origem do movimento (ex.: 'nfe' + id da nota); opcional. */
  origem_tipo?: string | null;
  origem_id?: string | null;
}

export interface RepoEstoque {
  /** Lista do contrato de listas (D-05): `id > cursor ORDER BY id`; `busca` no produto (código, descrição) ou na filial (razão social, fantasia). */
  listar(q: EstoqueConsulta): Promise<Pagina<SaldoEstoqueItem>>;
  saldos(q: { filial_id?: string; produto_id?: string }): Promise<SaldoEstoque[]>;
  /** Saldos de uma filial para vários produtos, em lote (produto sem linha fica fora). */
  saldosDe(filialId: string, produtoIds: readonly string[]): Promise<SaldoEstoque[]>;
  /** Lê o saldo travando a linha (`FOR UPDATE`): dois movimentos simultâneos não furam a RN-CAD-07. */
  saldoParaAtualizar(filialId: string, produtoId: string): Promise<number>;
  /** Saldos por cursor `(produto_id, filial_id)` crescente: a carga inicial (C-4). */
  paginaPorCursor(apos: { filial_id: string; produto_id: string } | null, limite: number): Promise<SaldoEstoque[]>;
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
  /** C-1: nome do IBGE por código de município (o que não existir fica fora do mapa). */
  nomesMunicipios(codigos: readonly string[]): Promise<Map<string, string>>;
  ncmVigente(ncm: string, data: string): Promise<boolean>;
  /** O NCM tem CEST vigente em `cest_ncm` (segmento com substituição tributária). */
  ncmExigeCest(ncm: string, data: string): Promise<boolean>;
  cestVigente(cest: string, data: string): Promise<boolean>;
  cestCombinaComNcm(cest: string, ncm: string, data: string): Promise<boolean>;
  /** Municípios vigentes da UF (a carga lê uma vez por UF, RN-CAD-03). */
  municipiosDaUf(uf: string, data: string): Promise<{ ibge: string; nome: string }[]>;
}

/** Cadastros que as linhas da carga referenciam por `external_id` (D13). */
/** Cadastros que as linhas da carga referenciam por `external_id` (D13); a forma de pagamento não é tabela própria. */
export type AlvoExterno = 'filial' | 'vendedor' | 'condicao_pagamento' | 'produto' | 'tabela_preco' | 'cliente';
export type TabelaFilha = 'produto_unidade' | 'cliente_endereco';

export interface FilhoGravado {
  id: string;
  pai_id: string;
  external_id: string | null;
  inativo: boolean;
  atual: Record<string, unknown>;
}

export interface ItemPrecoGravado {
  id: string;
  external_id: string | null;
  preco_centavos: number;
  desconto_maximo_bp: number;
  /** RN-CAD-11: true = o desconto veio do produto e acompanha o dele; false = próprio (PUT de itens). */
  desconto_herdado: boolean;
  inativo: boolean;
}

/** O que só a carga de CSV (T-0026) precisa do banco; o resto usa os repositórios das rotas. */
export interface RepoCarga {
  /** Condições de uma forma de pagamento (D12), também as inativas. */
  condicoesDaForma(formaExternalId: string): Promise<CondicaoPagamento[]>;
  /** Condições ativas do tenant cuja forma (tPag) o ERP não aceita (RN-CAD-09): o comando do administrador as desativa. */
  condicoesAtivasDeFormaRecusada(): Promise<CondicaoPagamento[]>;
  /** Condições ativas de cartão (tPag 03) com `parcelas_cartao` nulo (RN-CAD-09): a limpeza preenche ou desativa. */
  condicoesAtivasCartaoSemParcelas(): Promise<CondicaoPagamento[]>;
  /** T-0108 (decisões 14 A e 17 B): condições ativas (não excluídas) com `prazo_medio_dias` nulo e ao menos uma parcela, travadas (`FOR UPDATE`). */
  condicoesAtivasSemPrazoMedio(): Promise<CondicaoPagamento[]>;
  filhoPorExternalId(tabela: TabelaFilha, externalId: string): Promise<FilhoGravado | null>;
  unidadePorChave(produtoId: string, unidade: string): Promise<FilhoGravado | null>;
  reativarFilho(tabela: TabelaFilha, id: string): Promise<void>;
  itemPrecoPorExternalId(externalId: string): Promise<ItemPrecoGravado | null>;
  itemPrecoPorChave(tabelaId: string, filialId: string, produtoId: string): Promise<ItemPrecoGravado | null>;
  /** Upsert por (tabela, filial, produto): o `external_id` é adotado e `inativo` marca `deleted_at`. */
  gravarItemPreco(p: { tabelaId: string; filialId: string; produtoId: string; preco_centavos: number; desconto_maximo_bp: number; desconto_herdado: boolean; externalId: string; inativo: boolean }): Promise<PrecoItemComChave>;
  /** SAVEPOINT por linha (D7): erro de banco na linha desfaz só ela. */
  comSavepoint<T>(fn: () => Promise<T>): Promise<T>;
  /** RN-CAD-11: desconto máximo do produto (pontos-base); nulo = não informado. */
  descontoDoProduto(produtoId: string): Promise<number | null>;
  /** RN-CAD-11: grava o desconto no produto e atualiza os itens de preço ativos herdados; devolve os itens alterados (a carga os republica). */
  gravarDescontoProduto(produtoId: string, bp: number): Promise<PrecoItemComChave[]>;
}

/** Tabelas que o "Substituir tudo" do /config inativa (RN-CAD-10): forma de pagamento e estoque não têm registro próprio com `external_id`. */
export type TabelaSubstituivel =
  | 'filial' | 'vendedor' | 'condicao_pagamento' | 'produto' | 'produto_unidade' | 'tabela_preco_item' | 'cliente' | 'cliente_endereco';

export interface ExistenteSubstituivel {
  id: string;
  external_id: string | null;
  inativo: boolean;
  /** Cadastro-pai das filhas (produto da unidade, cliente do endereço, tabela do item de preço); `null` nas demais. */
  pai_id: string | null;
}

/** Banco do "Substituir tudo" (RN-CAD-10, T-0058): inativa em lote, nunca apaga. Sempre no tenant da transação. */
export interface RepoSubstituicao {
  /** Todos os registros da tabela no tenant, ativos e inativos. */
  existentes(tabela: TabelaSubstituivel): Promise<ExistenteSubstituivel[]>;
  /** Há ao menos um registro ativo (a dependência "já carregada", RF-CAD-11). */
  temAtivos(tabela: TabelaSubstituivel): Promise<boolean>;
  /** `deleted_at = now()` só nos ativos dos `ids`; devolve os ids realmente inativados. */
  inativarEmLote(tabela: TabelaSubstituivel, ids: readonly string[]): Promise<string[]>;
  /** Itens de preço com as chaves, inclusive inativos (para o evento `cadastros.preco.alterado@1`). */
  itensPreco(ids: readonly string[]): Promise<PrecoItemComChave[]>;
}

/** Tabelas com `external_id` que a resolução de chaves (ADR 0010) e a guarda da RD-0317 consultam. */
export type TabelaChave =
  | 'cliente' | 'vendedor' | 'filial' | 'produto' | 'condicao_pagamento' | 'cliente_endereco'
  | 'tabela_preco' | 'produto_unidade' | 'tabela_preco_item';

/** Consultas de chave em lote (ADR 0010). Nunca filtram `deleted_at`, salvo `soAtivos` (a carga): o inativo também resolve (o pedido devolve `*_inativo`). */
export interface RepoChaves {
  /** `external_id` → `id`, em uma consulta; `soAtivos` (a carga confere referências) ignora os inativos. */
  idsPorExternalId(tabela: TabelaChave, externalIds: readonly string[], soAtivos?: boolean): Promise<Map<string, string>>;
  /** Dos `ids`, os que existem com `external_id` nulo (RD-0317: o UUID só vale para o que nasceu no ERP), em uma consulta. */
  idsSemExternalId(tabela: TabelaChave, ids: readonly string[]): Promise<Set<string>>;
  /** Existe registro com este `id` (ativo ou inativo)? Guarda da RD-0317. */
  existeId(tabela: TabelaChave, id: string): Promise<boolean>;
}

export interface Repositorios {
  chaves: RepoChaves;
  filiais: RepoFiliais;
  clientes: RepoClientes;
  produtos: RepoProdutos;
  tabelasPreco: RepoTabelasPreco;
  estoque: RepoEstoque;
  condicoesPagamento: RepoSimples<CondicaoPagamento, CondicaoPagamentoDados>;
  vendedores: RepoVendedores;
  consultaExterna: RepoConsultaExterna;
  oficiais: RepoOficiais;
  carga: RepoCarga;
  substituicao: RepoSubstituicao;
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
  /** "Em uso" do Substituir tudo (RN-CAD-10, /config). Ausente = nada em uso (só o aviso `mantidos_em_uso` some). */
  usoCadastros?: ConsultaUsoCadastros;
}
