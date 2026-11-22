/**
 * Contratos públicos do módulo cadastros (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 * Rotas e permissões: docs/desenho/T-0002.md, seção 4. Eventos: .coord/contratos/eventos.md.
 * Dinheiro em centavos; quantidade e fator × 10^4 (D11); desconto em pontos-base (10_000 = 100%).
 */
import { Cnpj, ConsultaLista, ConsultaPaginada, normalizarDocumento } from '@macuxierp/platform-sdk';
import { z } from 'zod';

export const MODULO = 'cadastros' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

export const Uuid = z.string().uuid();
/** RN-CAD-03: município sempre pelo código IBGE de 7 dígitos. */
export const Ibge = z.string().regex(/^\d{7}$/);
export const Uf = z.string().regex(/^[A-Z]{2}$/);
export const Cep = z.string().regex(/^\d{8}$/);
/** Quantidade × 10^4 (D11). */
export const Qtd4 = z.number().int();
export const Centavos = z.number().int().min(0);
const Ean = z.string().regex(/^(\d{8}|\d{12,14}|SEM GTIN)$/);
const Texto = (max: number) => z.string().trim().min(1).max(max);
/** RD-0029: `external_id` com 1 a 64 caracteres (o `CHECK` do banco); a carga e o estoque usam o valor obrigatório. */
export const IdExternoValor = z.string().trim().min(1).max(64);
export const IdExterno = IdExternoValor.nullable().optional();

export const Endereco = z.object({
  logradouro: Texto(60),
  numero: Texto(60),
  complemento: z.string().max(60).nullable().default(null),
  bairro: Texto(60),
  municipio_ibge: Ibge,
  uf: Uf,
  cep: Cep,
  pais_bacen: z.string().regex(/^\d{1,4}$/).default('1058'),
});
export type Endereco = z.infer<typeof Endereco>;

// ---- Filial (RF-CAD-08; D8: a numeração da NF-e é do faturamento) ----
export const FilialDados = z.object({
  cnpj: Cnpj,
  ie: z.string().trim().toUpperCase().max(14).nullable().default(null),
  razao_social: Texto(60),
  nome_fantasia: z.string().max(60).nullable().default(null),
  crt: z.enum(['1', '2', '3', '4']),
  endereco: Endereco,
  padrao: z.boolean().default(false),
  emissora: z.boolean().default(false),
  nfe_serie: z.number().int().min(0).max(999).nullable().default(null),
  nfe_numero_inicial: z.number().int().min(1).max(999_999_999).nullable().default(null),
  external_id: IdExterno,
});
export type FilialDados = z.infer<typeof FilialDados>;
export const FilialAtualizacao = FilialDados.partial();
export type FilialAtualizacao = z.infer<typeof FilialAtualizacao>;
export const Filial = FilialDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type Filial = z.infer<typeof Filial>;

// ---- Cliente (RF-CAD-01) ----
export const TipoEndereco = z.enum(['principal', 'entrega', 'cobranca']);
export const EnderecoCliente = Endereco.extend({ tipo: TipoEndereco.default('principal') });
export type EnderecoCliente = z.infer<typeof EnderecoCliente>;
export const Contato = z.object({
  nome: Texto(80),
  email: z.string().email().max(254).nullable().default(null),
  telefone: z.string().regex(/^\d{10,13}$/).nullable().default(null),
  papel: z.string().max(40).nullable().default(null),
});
export type Contato = z.infer<typeof Contato>;

export const IndIeDest = z.enum(['1', '2', '9']);
export const ClienteDados = z.object({
  tipo_pessoa: z.enum(['PJ', 'PF']),
  /** CNPJ ou CPF; a API normaliza e valida pelo `tipo_pessoa` (RN-CAD-01). */
  documento: z.string().transform(normalizarDocumento),
  ie: z.string().trim().toUpperCase().max(14).nullable().default(null),
  /** RN-CAD-02 */
  ind_ie_dest: IndIeDest,
  razao_social: Texto(60),
  nome_fantasia: z.string().max(60).nullable().default(null),
  email_nfe: z.string().email().max(254).nullable().default(null),
  limite_credito_centavos: Centavos.default(0),
  condicao_pagamento_id: Uuid.nullable().default(null),
  tabela_preco_id: Uuid.nullable().default(null),
  filial_id: Uuid,
  vendedor_id: Uuid.nullable().default(null),
  enderecos: z.array(EnderecoCliente).min(1).max(10),
  external_id: IdExterno,
});
export type ClienteDados = z.infer<typeof ClienteDados>;
/** `enderecos` e contatos têm rotas próprias na edição (`/clientes/:id/enderecos|contatos`). */
export const ClienteAtualizacao = ClienteDados.omit({ enderecos: true }).partial();
export type ClienteAtualizacao = z.infer<typeof ClienteAtualizacao>;
export const Cliente = ClienteDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type Cliente = z.infer<typeof Cliente>;
export const EnderecoClienteItem = EnderecoCliente.extend({ id: Uuid });
export type EnderecoClienteItem = z.infer<typeof EnderecoClienteItem>;
export const ContatoItem = Contato.extend({ id: Uuid });
export type ContatoItem = z.infer<typeof ContatoItem>;

// ---- Produto (RF-CAD-04) ----
export const ProdutoDados = z.object({
  codigo: Texto(60),
  descricao: Texto(120),
  ncm: z.string().regex(/^\d{8}$/),
  /** RN-CAD-04 */
  cest: z.string().regex(/^\d{7}$/).nullable().default(null),
  unidade_comercial: Texto(6),
  unidade_tributavel: Texto(6),
  fator_tributavel: Qtd4.min(1).default(10_000),
  ean: Ean.nullable().default(null),
  marca: z.string().max(60).nullable().default(null),
  origem: z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8']).default('0'),
  grupo_tributacao: Texto(30),
  /** Nunca vai ao FDV; a API só o mostra a quem edita produto. */
  custo_centavos: Centavos.nullable().default(null),
  external_id: IdExterno,
});
export type ProdutoDados = z.infer<typeof ProdutoDados>;
export const ProdutoAtualizacao = ProdutoDados.partial();
export type ProdutoAtualizacao = z.infer<typeof ProdutoAtualizacao>;
export const Produto = ProdutoDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type Produto = z.infer<typeof Produto>;
export const UnidadeDados = z.object({
  unidade: Texto(6),
  fator: Qtd4.min(1),
  ean: Ean.nullable().default(null),
});
export type UnidadeDados = z.infer<typeof UnidadeDados>;
export const UnidadeItem = UnidadeDados.extend({ id: Uuid });
export type UnidadeItem = z.infer<typeof UnidadeItem>;

// ---- Tabela de preço (RF-CAD-05) ----
export const TabelaPrecoDados = z.object({
  nome: Texto(60),
  vigencia_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vigencia_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  padrao: z.boolean().default(false),
  external_id: IdExterno,
});
export type TabelaPrecoDados = z.infer<typeof TabelaPrecoDados>;
export const TabelaPrecoAtualizacao = TabelaPrecoDados.partial();
export const TabelaPreco = TabelaPrecoDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type TabelaPreco = z.infer<typeof TabelaPreco>;

export const PrecoItem = z.object({
  tabela_preco_id: Uuid,
  filial_id: Uuid,
  produto_id: Uuid,
  preco_centavos: Centavos,
  /** Pontos-base: 10_000 = 100%. */
  desconto_maximo_bp: z.number().int().min(0).max(10_000),
});
export type PrecoItem = z.infer<typeof PrecoItem>;
/** Item na lista paginada: o `id` da linha é o cursor. */
export const PrecoItemLista = PrecoItem.extend({ id: Uuid });
export type PrecoItemLista = z.infer<typeof PrecoItemLista>;
/** `GET /tabelas-preco/:id/itens`. */
export const PrecoItemConsulta = ConsultaPaginada.extend({ filial_id: Uuid.optional(), produto_id: Uuid.optional() });
export type PrecoItemConsulta = z.infer<typeof PrecoItemConsulta>;
export const MAX_ITENS_LOTE_PRECO = 5000;
/** Item do `PUT /tabelas-preco/:id/itens` (a tabela vem da rota). */
export const PrecoItemEntrada = PrecoItem.omit({ tabela_preco_id: true }).extend({
  desconto_maximo_bp: z.number().int().min(0).max(10_000).default(0),
});
export type PrecoItemEntrada = z.infer<typeof PrecoItemEntrada>;
export const PrecoLote = z.object({ itens: z.array(PrecoItemEntrada).min(1).max(MAX_ITENS_LOTE_PRECO) });
export type PrecoLote = z.infer<typeof PrecoLote>;
export const PrecoVigenteConsulta = z.object({
  produto_id: Uuid,
  filial_id: Uuid,
  tabela_preco_id: Uuid,
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const PrecoVigente = PrecoItem.extend({
  /** Filial de onde o preço veio: a padrão quando a filial pedida não tem item (RN-CAD-06). */
  origem_filial_id: Uuid,
  vigencia_inicio: z.string(),
  vigencia_fim: z.string().nullable(),
});
export type PrecoVigente = z.infer<typeof PrecoVigente>;

// ---- Estoque (RF-CAD-06) ----
export const MovimentoEstoque = z.object({
  filial_id: Uuid,
  produto_id: Uuid,
  tipo: z.enum(['entrada', 'saida', 'ajuste']),
  /** Entrada e saída: positivo. Ajuste: com sinal, diferente de zero. × 10^4. */
  quantidade: Qtd4,
  motivo: Texto(120),
  external_id: IdExternoValor.optional(),
});
export type MovimentoEstoque = z.infer<typeof MovimentoEstoque>;
export const SaldoEstoque = z.object({ filial_id: Uuid, produto_id: Uuid, quantidade: Qtd4 });
export type SaldoEstoque = z.infer<typeof SaldoEstoque>;

// ---- Condição de pagamento (RF-CAD-09) ----
/** RN-CAD-09: limites das condições de pagamento (parcelas do cartão, parcelas do boleto, dias por parcela). */
export const MAX_PARCELAS_CARTAO = 12;
export const MAX_PARCELAS = 36;
export const MAX_DIAS = 999;
export const CondicaoPagamentoDados = z.object({
  codigo: Texto(20),
  descricao: Texto(60),
  /** tPag da NF-e */
  forma_tpag: z.string().regex(/^\d{2}$/),
  prazos_dias: z.array(z.number().int().min(0).max(MAX_DIAS)).min(1).max(MAX_PARCELAS),
  /** RN-CAD-09: parcelas do cartão de crédito (tPag 03), 1 a 12; nulo ou ausente nas demais formas (opcional para não quebrar quem monta a condição à mão). Aditivo, `@1` continua valendo. */
  parcelas_cartao: z.number().int().min(1).max(MAX_PARCELAS_CARTAO).nullable().optional(),
  /** D12 (T-0026): a forma de pagamento da carga viaja junto da condição; aditivo e opcional, `@1` continua valendo. */
  forma_external_id: IdExterno,
  forma_codigo: z.string().max(20).nullable().default(null),
  forma_nome: z.string().max(60).nullable().default(null),
  external_id: IdExterno,
});
export type CondicaoPagamentoDados = z.infer<typeof CondicaoPagamentoDados>;
/** RN-CAD-09: classe da forma de pagamento, derivada do tPag da NF-e (nunca gravada). */
export const CLASSE_FORMA = { '01': 'a_vista', '17': 'a_vista', '04': 'a_vista', '03': 'cartao', '15': 'boleto' } as const;
export type ClasseForma = (typeof CLASSE_FORMA)[keyof typeof CLASSE_FORMA];
/** Classe do tPag, ou `null` quando a forma não é aceita (só Dinheiro, PIX, Cartão e Boleto). */
export const classeForma = (tpag: string): ClasseForma | null => (Object.prototype.hasOwnProperty.call(CLASSE_FORMA, tpag) ? CLASSE_FORMA[tpag as keyof typeof CLASSE_FORMA] : null);
/** tPag à vista: 01 dinheiro, 17 PIX, 04 cartão de débito. */
export const FORMAS_A_VISTA = (Object.keys(CLASSE_FORMA) as (keyof typeof CLASSE_FORMA)[]).filter((f) => CLASSE_FORMA[f] === 'a_vista');
/** Critério único de "à vista" (pedido, faturamento): só a forma de pagamento (RN-CAD-09 garante o prazo 0). */
export const ehAVista = (c: Pick<CondicaoPagamentoDados, 'forma_tpag'>): boolean => classeForma(c.forma_tpag) === 'a_vista';
export const CondicaoPagamentoAtualizacao = CondicaoPagamentoDados.partial();
export const CondicaoPagamento = CondicaoPagamentoDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type CondicaoPagamento = z.infer<typeof CondicaoPagamento>;

// ---- Vendedor e carteira (RF-CAD-07, D7) ----
export const VendedorDados = z.object({
  codigo: Texto(20),
  nome: Texto(80),
  filial_id: Uuid,
  usuario_id: Uuid.nullable().default(null),
  external_id: IdExterno,
});
export type VendedorDados = z.infer<typeof VendedorDados>;
export const VendedorAtualizacao = VendedorDados.partial();
export const Vendedor = VendedorDados.extend({ id: Uuid, inativo: z.boolean().default(false) });
export type Vendedor = z.infer<typeof Vendedor>;
export const TransferenciaCarteira = z.object({
  de: Uuid,
  para: Uuid,
  /** Sem a lista, transfere a carteira inteira de `de`. */
  cliente_ids: z.array(Uuid).min(1).max(5000).optional(),
});
export type TransferenciaCarteira = z.infer<typeof TransferenciaCarteira>;

// ---- Listas ----
/** Paginação por cursor do SDK (`.coord/contratos/listas.md`): `limite`, `cursor`, `busca` e `inativos`, mais os filtros do módulo. */
export const ListaConsulta = ConsultaLista.extend({
  filial_id: Uuid.optional(),
  vendedor_id: Uuid.optional(),
});
export type ListaConsulta = z.infer<typeof ListaConsulta>;
/** Lista do estoque no contrato de listas do SDK (D-05): `busca` (código ou descrição do produto, razão social ou fantasia da filial), `cursor` e `limite`. */
export const EstoqueConsulta = ConsultaPaginada.extend({ busca: ConsultaLista.shape.busca, filial_id: Uuid.optional(), produto_id: Uuid.optional() });
export type EstoqueConsulta = z.infer<typeof EstoqueConsulta>;
/** Linha da lista do estoque: o `id` da linha do saldo é o cursor (ordem estável por `id`). O evento segue com `SaldoEstoque`, sem `id`. */
export const SaldoEstoqueItem = SaldoEstoque.extend({ id: Uuid });
export type SaldoEstoqueItem = z.infer<typeof SaldoEstoqueItem>;

// ---- Consultas externas (RF-CAD-02/03, RN-CAD-05): só sugestão ----
export const FonteConsulta = z.enum(['brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz']);
export const SugestaoCnpj = z.object({
  cnpj: z.string(),
  razao_social: z.string().nullable(),
  nome_fantasia: z.string().nullable(),
  situacao_cadastral: z.string().nullable(),
  cnae_fiscal: z.string().nullable(),
  endereco: Endereco.partial().extend({ municipio: z.string().nullable().default(null) }),
});
export type SugestaoCnpj = z.infer<typeof SugestaoCnpj>;
export const SugestaoCep = z.object({
  cep: Cep,
  logradouro: z.string().nullable(),
  bairro: z.string().nullable(),
  complemento: z.string().nullable(),
  municipio: z.string().nullable(),
  municipio_ibge: Ibge.nullable(),
  uf: Uf.nullable(),
});
export type SugestaoCep = z.infer<typeof SugestaoCep>;
export const ResultadoConsulta = <T extends z.ZodTypeAny>(sugestao: T) =>
  z.object({ sugestao: sugestao, fonte: FonteConsulta, consultado_em: z.string().datetime() });
export const ConsultaIeEntrada = z.object({
  filial_id: Uuid,
  uf: Uf,
  /** IE ou CNPJ a consultar. Nunca CPF. */
  documento: z.string().transform(normalizarDocumento),
});
export type ConsultaIeEntrada = z.infer<typeof ConsultaIeEntrada>;
export const ConsultaIeResposta = z.object({
  id: Uuid,
  estado: z.enum(['pendente', 'concluida', 'falhou']),
  resultado: z
    .object({ situacao: z.string(), ie: z.string().nullable(), consultado_em: z.string().datetime() })
    .nullable(),
});
export type ConsultaIeResposta = z.infer<typeof ConsultaIeResposta>;
export const TRABALHO_CONSULTAR_IE = 'cadastros.consultar_ie' as const;

// ---- Tabelas oficiais (RF-CAD-10), só leitura ----
export const TABELAS_OFICIAIS = ['ncm', 'cest', 'cfop', 'cst', 'municipios', 'classificacao-tributaria'] as const;
export const OficialConsulta = ConsultaPaginada.extend({
  busca: ConsultaLista.shape.busca,
  uf: Uf.optional(),
  tipo: z.string().max(10).optional(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type OficialConsulta = z.infer<typeof OficialConsulta>;

// ---- Carga inicial por CSV (T-0026; docs/desenho/T-0026.md, seções 3 e 6) ----
/** Ordem de dependência da carga (D13). */
export const ENTIDADES_CARGA = [
  'filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto',
  'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco',
] as const;
/** Arquivos do kit fora da v1: ignorados com aviso, sem erro (D1). */
export const ENTIDADES_IGNORADAS = ['catalogo_no', 'tabela_escalonada', 'transportadora', 'rota', 'titulo', 'nota'] as const;
export const EntidadeCarga = z.enum(ENTIDADES_CARGA);
export type EntidadeCarga = z.infer<typeof EntidadeCarga>;
export const ModoCarga = z.enum(['validar', 'gravar']);
export type ModoCarga = z.infer<typeof ModoCarga>;
export const MAX_BYTES_LOTE = 10 * 1024 * 1024;
export const MAX_LINHAS_LOTE = 20_000;
export const MAX_ERROS_RELATORIO = 5000;
/** Arquivos por envio (um por entidade; a CLI manda até este número por POST). */
export const MAX_ARQUIVOS_LOTE = 16;

/** Pedido já lido do multipart: `modo` e um arquivo por entidade. O conteúdo não é guardado (D9). */
export const CargaPedido = z.object({
  modo: ModoCarga,
  arquivos: z.array(z.object({ nome: z.string().regex(/^[a-z_]+\.csv$/i), bytes: z.instanceof(Uint8Array) })).min(1).max(16), // = MAX_ARQUIVOS_LOTE; o teste de sincronia da CLI lê este literal (ver contracts.test)
});
export type CargaPedido = z.infer<typeof CargaPedido>;
/** Campos de texto do multipart `POST /v1/cadastros/cargas`; os arquivos vão no campo `arquivos`. */
export const CargaCampos = CargaPedido.pick({ modo: true });
export type CargaCampos = z.infer<typeof CargaCampos>;

const LinhaBase = { linha: z.number().int().min(2), external_id: IdExternoValor, ativo: z.boolean().optional() };
/** Avisos da linha (texto fixo, sem valor digitado). */
const AvisosLinha = { avisos: z.array(z.string().max(200)).default([]) };
const Refs = <K extends string>(...chaves: K[]) =>
  z.object(Object.fromEntries(chaves.map((k) => [k, IdExternoValor.optional()])) as Record<K, z.ZodOptional<typeof IdExternoValor>>);
/** Linha normalizada: `undefined` = célula vazia = não altera (D6). */
export const LinhaFilial = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: FilialDados.omit({ endereco: true, external_id: true, padrao: true, emissora: true, nfe_serie: true, nfe_numero_inicial: true }).partial(),
  endereco: Endereco.partial().optional(),
});
export const LinhaVendedor = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: z.object({ codigo: Texto(20), nome: Texto(80) }).partial(),
  refs: Refs('filial'),
});
export const LinhaFormaPagamento = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: z.object({ forma_codigo: Texto(20), forma_nome: Texto(60), forma_tpag: z.string().regex(/^\d{2}$/) }).partial(),
});
export const LinhaPrazoPagamento = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: z.object({ codigo: Texto(20), descricao: Texto(60), prazos_dias: CondicaoPagamentoDados.shape.prazos_dias, parcelas_cartao: z.number().int().min(1).max(99).nullable().optional() }).partial(), // 1..99 aqui; a faixa 1..MAX_PARCELAS_CARTAO é do domain (RN-CAD-09 com a mensagem do cartão)
  refs: Refs('forma'),
});
export const LinhaProduto = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: ProdutoDados.omit({ external_id: true, unidade_tributavel: true, fator_tributavel: true }).partial(),
  /** Pontos-base (D11 da T-0002): 12,5% = 1250. */
  desconto_maximo_bp: z.number().int().min(0).max(10_000).optional(),
});
export const LinhaProdutoUnidade = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: UnidadeDados.partial(),
  refs: Refs('produto'),
});
export const LinhaPreco = z.object({
  ...LinhaBase, ...AvisosLinha,
  tabela: z.object({
    external_id: IdExternoValor,
    nome: Texto(60),
    vigencia_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vigencia_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  preco_centavos: Centavos,
  /** Coluna `unidade` do kit: a API confere com a unidade comercial do produto (sem preço por unidade na v1). */
  unidade: Texto(6).optional(),
  refs: Refs('produto', 'filial'),
});
export const LinhaEstoque = z.object({
  ...LinhaBase, ...AvisosLinha,
  saldo: Qtd4,
  refs: Refs('produto', 'filial'),
});
export const LinhaCliente = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: ClienteDados.omit({
    enderecos: true, filial_id: true, vendedor_id: true, tabela_preco_id: true, condicao_pagamento_id: true, external_id: true,
  }).partial(),
  endereco_principal: EnderecoCliente.partial().optional(),
  refs: Refs('filial', 'vendedor', 'tabela_preco', 'condicao_pagamento'),
});
export const LinhaClienteEndereco = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: EnderecoCliente.partial(),
  refs: Refs('cliente'),
});
export type LinhaFilial = z.infer<typeof LinhaFilial>;
export type LinhaVendedor = z.infer<typeof LinhaVendedor>;
export type LinhaFormaPagamento = z.infer<typeof LinhaFormaPagamento>;
export type LinhaPrazoPagamento = z.infer<typeof LinhaPrazoPagamento>;
export type LinhaProduto = z.infer<typeof LinhaProduto>;
export type LinhaProdutoUnidade = z.infer<typeof LinhaProdutoUnidade>;
export type LinhaPreco = z.infer<typeof LinhaPreco>;
export type LinhaEstoque = z.infer<typeof LinhaEstoque>;
export type LinhaCliente = z.infer<typeof LinhaCliente>;
export type LinhaClienteEndereco = z.infer<typeof LinhaClienteEndereco>;
export interface LinhasCarga {
  filial: LinhaFilial;
  vendedor: LinhaVendedor;
  forma_pagamento: LinhaFormaPagamento;
  prazo_pagamento: LinhaPrazoPagamento;
  produto: LinhaProduto;
  produto_unidade: LinhaProdutoUnidade;
  preco: LinhaPreco;
  estoque: LinhaEstoque;
  cliente: LinhaCliente;
  cliente_endereco: LinhaClienteEndereco;
}

/** `RN-...` (regra do domain) ou `D<n>` (decisão do desenho) viram o código; os demais são da carga. */
export const CodigoErroCarga = z.union([
  z.string().regex(/^(RN-[A-Z]+-\d{2}|D\d{1,2})$/),
  z.enum([
    'CARGA_FORMATO', 'CARGA_OBRIGATORIO', 'CARGA_TAMANHO', 'CARGA_REFERENCIA', 'CARGA_DUPLICADO',
    'CARGA_CONFLITO', 'CARGA_BANCO', 'PERFIL_SEM_PERMISSAO',
  ]),
]);
/** Nunca leva o valor digitado (D9): `motivo` sai de mensagem fixa por código. */
export const ErroCarga = z.object({
  arquivo: z.string(),
  /** `null` = erro do arquivo (cabeçalho, codificação). */
  linha: z.number().int().nullable(),
  campo: z.string().nullable(),
  codigo: CodigoErroCarga,
  motivo: z.string().max(200),
});
export type ErroCarga = z.infer<typeof ErroCarga>;
export const ResultadoEntidade = z.object({
  entidade: z.enum([...ENTIDADES_CARGA, ...ENTIDADES_IGNORADAS]),
  arquivo: z.string(),
  situacao: z.enum(['processado', 'recusado', 'ignorado']),
  lidas: z.number().int().min(0),
  inseridas: z.number().int().min(0),
  atualizadas: z.number().int().min(0),
  sem_mudanca: z.number().int().min(0),
  recusadas: z.number().int().min(0),
  colunas_ignoradas: z.array(z.string()),
  avisos: z.array(z.string().max(200)),
});
export type ResultadoEntidade = z.infer<typeof ResultadoEntidade>;
export const RelatorioCarga = z.object({
  lote_id: Uuid,
  modo: ModoCarga,
  iniciado_em: z.string().datetime(),
  concluido_em: z.string().datetime(),
  entidades: z.array(ResultadoEntidade),
  erros: z.array(ErroCarga).max(MAX_ERROS_RELATORIO),
  erros_omitidos: z.number().int().min(0),
});
export type RelatorioCarga = z.infer<typeof RelatorioCarga>;

// ---- Eventos publicados (payloads v1; .coord/contratos/eventos.md) ----
const Inativo = z.object({ inativo: z.boolean() });
/**
 * C-1: endereço nos eventos = `Endereco` + `municipio_nome` (nome do IBGE, de `cadastros.municipio` pelo código). Aditivo no @1.
 * `nullable`: o código pode não estar na tabela oficial; `optional`: os eventos já gravados na outbox não têm o campo e o
 * leitor é tolerante. O publicador sempre preenche (nome ou `null`).
 */
const MunicipioNome = z.string().nullable().optional();
const EnderecoEvento = Endereco.extend({ municipio_nome: MunicipioNome });
/** C-3: o evento do cliente traz o `id` de cada endereço e o `municipio_nome`; `id` opcional para ler eventos antigos (o publicador sempre preenche). */
const EnderecoClienteEvento = EnderecoClienteItem.extend({ id: Uuid.optional(), municipio_nome: MunicipioNome });
/** ADR 0010, item 3: toda mudança de `external_id` leva o valor de antes (`null` na adoção); aditivo e opcional no @1. */
const ExternalIdAnterior = z.object({ external_id_anterior: IdExterno });
/** Troca controlada do `external_id` (`POST /v1/cadastros/<entidade>/:id/external-id`, só administrador). */
export const TrocaExternalId = z.object({ external_id: IdExternoValor, motivo: Texto(200) });
export type TrocaExternalId = z.infer<typeof TrocaExternalId>;
export const EVENTOS = {
  'cadastros.filial.alterada@1': Filial.extend({ endereco: EnderecoEvento }).merge(Inativo).merge(ExternalIdAnterior),
  'cadastros.cliente.alterado@1': Cliente.extend({ enderecos: z.array(EnderecoClienteEvento) }).merge(Inativo).merge(ExternalIdAnterior),
  /** C-2: publicado na criação e na alteração da tabela; `agregado_id` = id da tabela. */
  'cadastros.tabela_preco.alterada@1': TabelaPreco.merge(Inativo).merge(ExternalIdAnterior),
  'cadastros.produto.alterado@1': Produto.merge(Inativo).extend({ unidades: z.array(UnidadeItem) }).merge(ExternalIdAnterior),
  'cadastros.preco.alterado@1': PrecoItem.merge(Inativo).extend({
    vigencia_inicio: z.string(),
    vigencia_fim: z.string().nullable(),
  }),
  'cadastros.estoque.alterado@1': SaldoEstoque,
  'cadastros.condicao_pagamento.alterada@1': CondicaoPagamento.merge(Inativo).merge(ExternalIdAnterior),
  'cadastros.vendedor.alterado@1': Vendedor.merge(Inativo).merge(ExternalIdAnterior),
  'cadastros.carteira.alterada@1': z.object({ de: Uuid, para: Uuid, cliente_ids: z.array(Uuid) }),
} as const;
export type NomeEventoCadastros = keyof typeof EVENTOS;


// ---- Consumo: carga inicial pedida pelo integracao-fdv (C-4) ----
export const EVENTO_CARGA_INICIAL = 'integracao-fdv.carga_inicial.solicitada@1' as const;
/** Zod local, sem importar o pacote do integracao-fdv (que depende de cadastros). */
export const SolicitacaoCargaInicial = z.object({ entidades: z.array(z.string()) }).passthrough();
export type SolicitacaoCargaInicial = z.infer<typeof SolicitacaoCargaInicial>;
/** Entidades que a carga republica (nome do Hub ou do ERP; apelidos levam à mesma entidade). */
export const ENTIDADES_CARGA_FDV = ['filial', 'vendedor', 'condicao_pagamento', 'produto', 'tabela_preco', 'preco', 'estoque', 'cliente'] as const;
export type EntidadeCargaFdv = (typeof ENTIDADES_CARGA_FDV)[number];
export const TRABALHO_CARGA_INICIAL = 'cadastros.carga_inicial' as const;
/** Payload do trabalho paginado da carga. */
export const PayloadCargaInicial = z.object({
  /** `id` do evento que pediu (`evento.id`, não o external_id): amarra a idempotência de toda a cadeia. */
  origem: z.string().min(1),
  entidade: z.enum(ENTIDADES_CARGA_FDV),
  /** Cursor: último id (ou `filial|produto` no estoque) já publicado; `null` = do começo. */
  apos: z.string().nullable(),
  /** Só no preço: tabela em curso e próxima página dos itens dela. */
  tabela_id: z.string().nullable().default(null),
  pagina: z.number().int().min(1).default(1),
  /** Só no preço: cursor dos itens da tabela em curso (lista por cursor); `null` = do começo. */
  cursor_itens: z.string().nullable().default(null),
});
export type PayloadCargaInicial = z.infer<typeof PayloadCargaInicial>;
