/**
 * Contratos públicos do módulo cadastros (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 * Rotas e permissões: docs/desenho/T-0002.md, seção 4. Eventos: .coord/contratos/eventos.md.
 * Dinheiro em centavos; quantidade e fator × 10^4 (D11); desconto em pontos-base (10_000 = 100%).
 */
import { Cnpj, ConsultaLista, ConsultaPaginada, PreviaZerarPlataformaEntrada, normalizarDocumento, type Transacao } from '@macuxierp/platform-sdk';
import { EXTERNAL_ID_MAX, LIMITE_CODIGO_FORMA_PAGAMENTO } from '@macuxierp/platform-sdk/hub-v1';
import { z } from 'zod';

export { validarFracaoDaQuantidade } from './fracao';

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
export const Ean = z.string().regex(/^(\d{8}|\d{12,14}|SEM GTIN)$/);
const Texto = (max: number) => z.string().trim().min(1).max(max);
/** RD-0029: `external_id` com 1 a `EXTERNAL_ID_MAX` caracteres (ADR 0019); a carga e o estoque usam o valor obrigatório. */
export const IdExternoValor = z.string().trim().min(1).max(EXTERNAL_ID_MAX);
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
  /** T-0096: localização (aditivo no @1); regra em normalizarCoordenada (domain). */
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
});
export type Endereco = z.infer<typeof Endereco>;

// ---- Filial (RF-CAD-08; D8: a numeração da NF-e é do faturamento) ----
/** Regime de PIS/COFINS da filial (RN-FIS-02). */
export const RegimePisCofins = z.enum(['cumulativo', 'nao_cumulativo']);
export type RegimePisCofins = z.infer<typeof RegimePisCofins>;
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
  /** Estabelecimento industrial para o IPI (RN-FIS-02, T-0021). Ausente = false; aditivo no @1. */
  industrial_ipi: z.boolean().optional(),
  /** Só vale no CRT 3 (RN-FIS-02). Ausente = null; aditivo no @1. */
  regime_pis_cofins: RegimePisCofins.nullable().optional(),
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

/** RN-CAD-09: limites das condições de pagamento (parcelas do cartão, parcelas do boleto, dias por parcela). */
export const MAX_PARCELAS_CARTAO = 12;
export const MAX_PARCELAS = 24;
export const MAX_DIAS = 365;
/** Limites do banco (CHECK da 0052) e dos eventos `@1` já publicados: mais largos que a entrada da RN-CAD-15/16 (regra 3 do CLAUDE.md: não estreitar `@1`). Só a entidade e o evento os usam. */
export const MAX_DIAS_LEGADO = 999;
export const MAX_PARCELAS_LEGADO = 36;
/** Prazo médio em dias lido do banco ou do evento `@1` (legado até MAX_DIAS_LEGADO). */
const PrazoMedioDiasLegado = z.number().int().min(0).max(MAX_DIAS_LEGADO);
/** RN-CAD-15 e RN-CAD-16: prazo médio em dias, digitado (0 a MAX_DIAS). */
export const PrazoMedioDias = z.number().int().min(0).max(MAX_DIAS);
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
  /** RN-CAD-16: prazo médio máximo do cliente (0 a MAX_DIAS), opcional; nulo = sem restrição de prazo. */
  prazo_medio_dias: PrazoMedioDias.nullish(),
  enderecos: z.array(EnderecoCliente).min(1).max(10),
  external_id: IdExterno,
});
export type ClienteDados = z.infer<typeof ClienteDados>;
/** `enderecos` e contatos têm rotas próprias na edição (`/clientes/:id/enderecos|contatos`). */
export const ClienteAtualizacao = ClienteDados.omit({ enderecos: true }).partial();
export type ClienteAtualizacao = z.infer<typeof ClienteAtualizacao>;
export const Cliente = ClienteDados.extend({ prazo_medio_dias: PrazoMedioDiasLegado.nullish(), id: Uuid, inativo: z.boolean().default(false) });
export type Cliente = z.infer<typeof Cliente>;
export const EnderecoClienteItem = EnderecoCliente.extend({ id: Uuid, external_id: IdExterno });
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
  /** Fabricado pelo estabelecimento (CFOP 5101/6101) × revendido (5102/6102); T-0021. Ausente = false; aditivo no @1. */
  producao_propria: z.boolean().optional(),
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
export const UnidadeItem = UnidadeDados.extend({ id: Uuid, external_id: IdExterno });
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
/** Item de preço com a chave do kit (ADR 0010): saída da leitura e do evento; a entrada do PUT não a aceita. */
export const PrecoItemComChave = PrecoItem.extend({ external_id: IdExterno });
export type PrecoItemComChave = z.infer<typeof PrecoItemComChave>;
/** Item na lista paginada: o `id` da linha é o cursor. */
export const PrecoItemLista = PrecoItem.extend({ id: Uuid, external_id: IdExterno });
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
export const CondicaoPagamentoDados = z.object({
  codigo: Texto(20),
  descricao: Texto(60),
  /** tPag da NF-e */
  forma_tpag: z.string().regex(/^\d{2}$/),
  prazos_dias: z.array(z.number().int().min(0).max(MAX_DIAS)).min(1).max(MAX_PARCELAS),
  /** RN-CAD-15 (decisão 14 A): `completarPrazoMedio`. */
  prazo_medio_dias: PrazoMedioDias.nullish(),
  /** Legado (RN-CAD-09 emendada pela RN-CAD-15): nº de parcelas do cartão (tPag 03), 1 a 12, derivado dos prazos; nulo nas demais formas. Aditivo, @1 continua valendo. */
  parcelas_cartao: z.number().int().min(1).max(MAX_PARCELAS_CARTAO).nullable().optional(),
  /** D12 (T-0026): a forma de pagamento da carga viaja junto da condição; aditivo e opcional, `@1` continua valendo. */
  forma_external_id: IdExterno,
  forma_codigo: z.string().max(LIMITE_CODIGO_FORMA_PAGAMENTO).nullable().default(null),
  forma_nome: z.string().max(60).nullable().default(null),
  external_id: IdExterno,
});
export type CondicaoPagamentoDados = z.infer<typeof CondicaoPagamentoDados>;
/** RN-CAD-09: classe da forma de pagamento, derivada do tPag da NF-e (nunca gravada). */
export const NOME_FORMA = { '01': 'Dinheiro', '17': 'PIX', '04': 'Cartão de débito', '03': 'Cartão de crédito', '15': 'Boleto' } as const;
export const CLASSE_FORMA = { '01': 'a_vista', '17': 'a_vista', '04': 'a_vista', '03': 'cartao', '15': 'boleto' } as const;
export type ClasseForma = (typeof CLASSE_FORMA)[keyof typeof CLASSE_FORMA];
/** Classe do tPag, ou `null` quando a forma não é aceita (só Dinheiro, PIX, Cartão e Boleto). */
export const classeForma = (tpag: string): ClasseForma | null => (Object.prototype.hasOwnProperty.call(CLASSE_FORMA, tpag) ? CLASSE_FORMA[tpag as keyof typeof CLASSE_FORMA] : null);
/** tPag à vista: 01 dinheiro, 17 PIX, 04 cartão de débito. */
export const FORMAS_A_VISTA = (Object.keys(CLASSE_FORMA) as (keyof typeof CLASSE_FORMA)[]).filter((f) => CLASSE_FORMA[f] === 'a_vista');
/** Critério único de "à vista" (pedido, faturamento): só a forma de pagamento (RN-CAD-09 garante o prazo 0). */
export const ehAVista = (c: Pick<CondicaoPagamentoDados, 'forma_tpag'>): boolean => classeForma(c.forma_tpag) === 'a_vista';
export const CondicaoPagamentoAtualizacao = CondicaoPagamentoDados.partial();
/** Entidade e evento `@1`: aceitam o legado (até MAX_DIAS_LEGADO dias e MAX_PARCELAS_LEGADO parcelas); a entrada (`CondicaoPagamentoDados`) segue em MAX_DIAS/MAX_PARCELAS. */
export const CondicaoPagamento = CondicaoPagamentoDados.extend({
  prazos_dias: z.array(z.number().int().min(0).max(MAX_DIAS_LEGADO)).min(1).max(MAX_PARCELAS_LEGADO),
  /** Aditivo também no tipo: ausente ou nulo = prazo incompleto (legado). */
  prazo_medio_dias: PrazoMedioDiasLegado.nullish(),
  /** RN-CAD-15 (decisão 14 A): `completarPrazoMedio`; aditivo opcional, @1 continua valendo. */
  prazo_medio_calculado: z.boolean().nullish(),
  id: Uuid, inativo: z.boolean().default(false) });
export type CondicaoPagamento = z.infer<typeof CondicaoPagamento>;

type PrazoParaConferir = Pick<CondicaoPagamento, 'codigo' | 'descricao' | 'prazos_dias'> & { prazo_medio_dias?: number | null; forma_tpag?: string };
/** RN-CAD-15: prazo completo = código, descrição, ao menos uma parcela e prazo médio não nulo (ausente ou nulo = "Incompleto"). */
export function prazoCompleto(c: PrazoParaConferir): boolean {
  return c.codigo.trim() !== '' && c.descricao.trim() !== '' && c.prazos_dias.length >= 1 && c.prazo_medio_dias !== null && c.prazo_medio_dias !== undefined;
}
/**
 * RN-CAD-16: o prazo é permitido ao cliente quando está completo e o cliente não tem prazo médio (nulo ou ausente) ou tem prazo médio >= o do prazo.
 * Exceção (decisão do Alexandre, 24/11): a forma Cartão de crédito (tPag 03) fica fora do limite; o prazo completo do cartão é permitido
 * a qualquer cliente. O prazo incompleto do cartão continua não permitido.
 */
export function prazoPermitidoAoCliente(prazo: PrazoParaConferir, cliente: { prazo_medio_dias?: number | null }): boolean {
  if (!prazoCompleto(prazo)) return false;
  if (prazo.forma_tpag !== undefined && classeForma(prazo.forma_tpag) === 'cartao') return true;
  return cliente.prazo_medio_dias === null || cliente.prazo_medio_dias === undefined || cliente.prazo_medio_dias >= (prazo.prazo_medio_dias as number);
}

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
  // Ampliação aditiva (T-0101, ADR 0012 emendada): todos opcionais e de leitura tolerante (resposta antiga continua válida).
  /** Códigos de CNAE secundários (7 dígitos), sem repetir o principal. */
  cnae_secundarios: z.array(z.string()).nullish(),
  porte: z.string().nullish(),
  natureza_juridica: z.string().nullish(),
  /** Contato da empresa (pode ser dado pessoal em MEI): só na resposta da consulta, nunca no cache nem em log. */
  email: z.string().nullish(),
  telefone: z.string().nullish(),
  opcao_simples: z.boolean().nullish(),
  opcao_mei: z.boolean().nullish(),
  /** AAAA-MM-DD. */
  data_situacao_cadastral: z.string().nullish(),
  /** AAAA-MM-DD; data de abertura (início da atividade). Aditivo (T-0101). */
  data_abertura: z.string().nullish(),
});
export type SugestaoCnpj = z.infer<typeof SugestaoCnpj>;

/** Resultado da porta `ConsultaCnpjParaCore` (T-0101): a falha da fonte volta como valor, nunca como exceção. */
export type ResultadoConsultaCnpj =
  | { ok: true; sugestao: SugestaoCnpj; fonte: z.infer<typeof FonteConsulta>; consultado_em: string }
  | { ok: false; motivo: 'fonte_indisponivel' | 'cnpj_invalido' | 'nao_encontrado' };
/**
 * Porta que o `core` chama (ficha da empresa pela Receita, ADR 0012): mesma consulta do RF-CAD-02, com cache de 24 h e IBGE
 * pela tabela oficial. Só sugestão; nunca grava cadastro. Roda na transação do tenant (o cache é do tenant). E-mail e
 * telefone só vêm na consulta fresca.
 */
export interface ConsultaCnpjParaCore {
  consultar(tx: Transacao, tenant: string, cnpj: string): Promise<ResultadoConsultaCnpj>;
}
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
  'filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente',
] as const;
/**
 * Arquivos do kit fora da v1: ignorados com aviso, sem erro (D1). `forma_pagamento`, `prazo_pagamento` e `cliente_endereco`
 * deixaram de ser cargas na T-0058 (condição de pagamento e cliente com endereço são um arquivo cada): seguem ignorados, com aviso.
 */
export const ENTIDADES_IGNORADAS = [
  'catalogo_no', 'tabela_escalonada', 'transportadora', 'rota', 'titulo', 'nota', 'forma_pagamento', 'prazo_pagamento', 'cliente_endereco',
] as const;
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
  /** RF-CAD-11: carga de uma entidade só (botão da tela); o lote tem de ser exatamente `<entidade>.csv`. */
  entidade: EntidadeCarga.optional(),
  arquivos: z.array(z.object({ nome: z.string().regex(/^[a-z_]+\.csv$/i), bytes: z.instanceof(Uint8Array) })).min(1).max(16), // = MAX_ARQUIVOS_LOTE; o teste de sincronia da CLI lê este literal (ver contracts.test)
});
export type CargaPedido = z.infer<typeof CargaPedido>;
/** Campos de texto do multipart `POST /v1/cadastros/cargas`; os arquivos vão no campo `arquivos`. */
export const CargaCampos = CargaPedido.pick({ modo: true, entidade: true });
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
/**
 * T-0058, RN-CAD-09: a condição de pagamento e a forma vêm na MESMA linha (cada condição tem uma forma). A forma é um dado
 * da condição (`forma_*`), não uma entidade da carga: `forma_external_id` ou, sem ele, `forma_codigo` identifica a forma no arquivo.
 */
export const LinhaCondicaoPagamento = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: z.object({
    codigo: Texto(20), descricao: Texto(60), prazos_dias: CondicaoPagamentoDados.shape.prazos_dias,
    prazo_medio_dias: PrazoMedioDias, // RN-CAD-15
    forma_external_id: IdExternoValor, forma_codigo: Texto(LIMITE_CODIGO_FORMA_PAGAMENTO), forma_nome: Texto(60), forma_tpag: z.string().regex(/^\d{2}$/),
  }).partial(),
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
/** T-0058: um endereço do cliente, vindo de uma linha do cliente.csv (`tipo_endereco` e `seq`); `external_id` = `<cliente>:<tipo>[:<seq>]`. */
export const EnderecoDaLinha = z.object({
  linha: z.number().int().min(2),
  external_id: IdExternoValor,
  tipo: TipoEndereco,
  seq: z.number().int().min(1).max(999).optional(),
  dados: Endereco.partial(),
});
export type EnderecoDaLinha = z.infer<typeof EnderecoDaLinha>;
/** Uma linha do cliente.csv vira esta linha; as linhas do mesmo `external_id` se juntam em uma só (`agruparClientes`), com `enderecos` de todas. */
export const LinhaCliente = z.object({
  ...LinhaBase, ...AvisosLinha,
  dados: ClienteDados.omit({
    enderecos: true, filial_id: true, vendedor_id: true, tabela_preco_id: true, condicao_pagamento_id: true, external_id: true,
  }).partial(),
  enderecos: z.array(EnderecoDaLinha).default([]),
  /** Linhas do arquivo que o cliente ocupa (a 1ª é a base dos dados do cliente). */
  linhas: z.array(z.number().int().min(2)).optional(),
  refs: Refs('filial', 'vendedor', 'tabela_preco', 'condicao_pagamento'),
});
export type LinhaFilial = z.infer<typeof LinhaFilial>;
export type LinhaVendedor = z.infer<typeof LinhaVendedor>;
export type LinhaCondicaoPagamento = z.infer<typeof LinhaCondicaoPagamento>;
export type LinhaProduto = z.infer<typeof LinhaProduto>;
export type LinhaProdutoUnidade = z.infer<typeof LinhaProdutoUnidade>;
export type LinhaPreco = z.infer<typeof LinhaPreco>;
export type LinhaEstoque = z.infer<typeof LinhaEstoque>;
export type LinhaCliente = z.infer<typeof LinhaCliente>;
export interface LinhasCarga {
  filial: LinhaFilial;
  vendedor: LinhaVendedor;
  condicao_pagamento: LinhaCondicaoPagamento;
  produto: LinhaProduto;
  produto_unidade: LinhaProdutoUnidade;
  preco: LinhaPreco;
  estoque: LinhaEstoque;
  cliente: LinhaCliente;
}

/** `RN-...` (regra do domain) ou `D<n>` (decisão do desenho) viram o código; os demais são da carga. */
export const CodigoErroCarga = z.union([
  z.string().regex(/^(RN-[A-Z]+-\d{2}|D\d{1,2})$/),
  z.enum([
    // CARGA_REFERENCIA: não emitido desde a v0.3.7; mantido por compatibilidade de leitura
    'CARGA_FORMATO', 'CARGA_OBRIGATORIO', 'CARGA_TAMANHO', 'CARGA_REFERENCIA', 'CARGA_DUPLICADO',
    'CARGA_CONFLITO', 'CARGA_BANCO', 'CARGA_DEPENDENCIA', 'PERFIL_SEM_PERMISSAO',
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
  /** RF-CAD-11: no `CARGA_DEPENDENCIA`, o arquivo que falta carregar (o shell não deduz pelo nome do campo). Ausente = não é CARGA_DEPENDENCIA. */
  entidade_faltante: EntidadeCarga.optional(),
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
  /** Só no `substituir_tudo` do /config (RN-CAD-10): quantos cadastros ativos que não vieram no arquivo foram inativados (nunca apagados). */
  inativadas: z.number().int().min(0).optional(),
  /** Só no `substituir_tudo` do /config: ativos sem external_id; NÃO são inativados, só contados (RN-CAD-10). */
  sem_chave: z.number().int().min(0).optional(),
  /** Só no cliente, no `substituir_tudo` do /config: endereços ativos que não vieram no arquivo e foram inativados junto (RN-CAD-10); nunca apagados. */
  enderecos_inativados: z.number().int().min(0).optional(),
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
  /** C-10 (ADR 0010): `external_id` do item (chave do kit) e `external_id_anterior` na adoção; aditivos no @1. */
  'cadastros.preco.alterado@1': PrecoItem.merge(Inativo).extend({
    vigencia_inicio: z.string(),
    vigencia_fim: z.string().nullable(),
    external_id: IdExterno,
  }).merge(ExternalIdAnterior),
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


/** `detalhes.codigo` do 422 `RN-CAD-10` de frase de confirmação errada (Substituir tudo e Zerar por cadastro; T-0093). */
export const CODIGO_FRASE_NAO_CONFERE = 'frase_nao_confere';

/** Corpo do `POST .../cadastros/zerar` (RN-CAD-10, T-0093): só a forma; a frase é conferida na rota (422 `RN-CAD-10`). */
export const ZerarCadastrosCorpo = PreviaZerarPlataformaEntrada.extend({ frase: z.string().max(200) });
export type ZerarCadastrosCorpo = z.infer<typeof ZerarCadastrosCorpo>;
