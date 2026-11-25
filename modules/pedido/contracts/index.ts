/**
 * Contratos públicos do módulo pedido (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { z } from 'zod';
import { Centavos, Cliente as ClienteSchema, EnderecoCliente as EnderecoClienteSchema, Produto as ProdutoSchema, Qtd4, Uuid } from '@macuxierp/cadastros/contracts';

export * from './zeragem';

export const MODULO = 'pedido' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

// ---- Enumerações (T-0013 §2, §3.1, §4.3 e §8) ----
export const OrigemPedido = z.enum(['fdv', 'bko']);
export type OrigemPedido = z.infer<typeof OrigemPedido>;

/** RN-PED-02. */
export const StatusPedido = z.enum(['recebido', 'em_analise', 'aprovado', 'recusado', 'faturado_parcial', 'faturado', 'cancelado']);
export type StatusPedido = z.infer<typeof StatusPedido>;

/** RN-PED-03 e RN-PED-04 (T-0013 §3.1). Declarado na ordem de exibição das pendências. */
export const CodigoPendencia = z.enum([
  'cliente_inativo',
  'produto_inativo',
  'filial_nao_emissora',
  'condicao_ausente',
  'condicao_inativa',
  'prazo_incompleto',
  'prazo_acima_do_cliente',
  'preco_sem_tabela',
  'desconto_acima_maximo',
  'credito_sem_limite',
  'credito_excedido',
  'estoque_insuficiente',
]);
export type CodigoPendencia = z.infer<typeof CodigoPendencia>;

/** Pendência sem valor: é o que vai no evento e no banco (T-0013 §3.1). */
export const Pendencia = z.object({
  codigo: CodigoPendencia,
  bloqueante: z.boolean(),
  sequencia: z.number().int().min(1).nullable(),
  produto_id: Uuid.nullable(),
});
export type Pendencia = z.infer<typeof Pendencia>;

/**
 * Pendência com os valores esperado e informado: só na resposta da API e na tela, nunca no evento.
 * Unidade por código (inteiros):
 * - `desconto_acima_maximo`: pontos-base (esperado = desconto máximo da tabela; informado = desconto aplicado, arredondado para baixo);
 * - `credito_sem_limite`: centavos (esperado = limite do cliente, 0; informado = total do pedido);
 * - `credito_excedido`: centavos (esperado = limite do cliente; informado = títulos abertos + compromisso + este pedido);
 * - `estoque_insuficiente`: Qtd4 (esperado = saldo livre, já descontado o compromisso, mínimo 0; informado = quantidade pedida do produto);
 * - `prazo_acima_do_cliente`: dias (esperado = prazo médio do cliente; informado = prazo médio do prazo; RN-PED-07);
 * - demais códigos: nulos.
 */
export const PendenciaDetalhada = Pendencia.extend({
  esperado: z.number().int().nullable().default(null),
  informado: z.number().int().nullable().default(null),
});
export type PendenciaDetalhada = z.infer<typeof PendenciaDetalhada>;

/** Motivos (T-0013 §4.3). */
export const MotivoRecusa = z.enum([
  'preco_divergente',
  'credito_insuficiente',
  'estoque_insuficiente',
  'cliente_bloqueado',
  'pedido_duplicado',
  'condicao_nao_aceita',
  'outro',
]);
export type MotivoRecusa = z.infer<typeof MotivoRecusa>;
export const MotivoCancelamento = z.enum(['solicitacao_cliente', 'pedido_duplicado', 'sem_estoque', 'erro_lancamento', 'outro']);
export type MotivoCancelamento = z.infer<typeof MotivoCancelamento>;
export const MotivoCodigo = z.enum([...new Set([...MotivoRecusa.options, ...MotivoCancelamento.options])] as [MotivoRecusa | MotivoCancelamento, ...(MotivoRecusa | MotivoCancelamento)[]]);
export type MotivoCodigo = z.infer<typeof MotivoCodigo>;

/** Resposta de `GET /v1/pedido/motivos`: o catálogo com o texto em português (T-0013 §4.3), para a tela montar o seletor. */
export const CatalogoMotivos = z.object({
  recusa: z.array(z.object({ codigo: MotivoRecusa, texto: z.string() })),
  cancelamento: z.array(z.object({ codigo: MotivoCancelamento, texto: z.string() })),
});
export type CatalogoMotivos = z.infer<typeof CatalogoMotivos>;

const MotivoTexto = z.string().trim().min(1).max(300).nullable().default(null);
const exigeTextoEmOutro = (v: { motivo_codigo: string; motivo_texto: string | null }, ctx: z.RefinementCtx) => {
  if (v.motivo_codigo === 'outro' && !v.motivo_texto) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo_texto'], message: "motivo_texto é obrigatório quando o motivo é 'outro'" });
  }
};

// ---- Entradas ----
export const ItemPedidoEntrada = z.object({
  produto_id: Uuid,
  /** Qtd4 (× 10^4), na unidade comercial do produto. */
  quantidade: Qtd4.positive(),
  preco_unitario_centavos: Centavos,
  desconto_centavos: Centavos.default(0),
});
export type ItemPedidoEntrada = z.infer<typeof ItemPedidoEntrada>;

/** RF-PED-02: pedido lançado no BKO. */
export const PedidoManualEntrada = z.object({
  filial_id: Uuid,
  cliente_id: Uuid,
  vendedor_id: Uuid.nullable().default(null),
  condicao_pagamento_id: Uuid.nullable().default(null),
  endereco_entrega_id: Uuid.nullable().default(null),
  observacao: z.string().max(500).nullable().default(null),
  itens: z.array(ItemPedidoEntrada).min(1).max(500),
  external_id: z.string().min(1).max(64).optional(),
});
export type PedidoManualEntrada = z.infer<typeof PedidoManualEntrada>;

export const Frete = z.object({
  modalidade: z.enum(['CIF', 'FOB']),
  transportadora: z.record(z.string(), z.unknown()).nullable().default(null),
  /** Centavos; nulo vale 0. Na v1 nem o FDV nem o BKO informam o valor (aditivo no @1, T-0021). */
  valor_centavos: Centavos.nullable().optional(),
});
export type Frete = z.infer<typeof Frete>;
/** Retrato do endereço de entrega: livre, mas sempre com `municipio_nome` (nulo quando desconhecido; aditivo no @1, T-0021). */
const RetratoEndereco = z.object({ municipio_nome: z.string().nullable().optional() }).passthrough();
export const EnderecoEntrega = z.object({ endereco_id: Uuid.nullable().default(null), retrato: RetratoEndereco.nullable().default(null) });
export type EnderecoEntrega = z.infer<typeof EnderecoEntrega>;

export const ItemPedidoFdvEntrada = z.object({
  sequencia: z.number().int().min(1),
  produto_id: Uuid,
  quantidade: Qtd4.positive(),
  unidade_venda: z.string().max(6).nullable().default(null),
  fator_venda: Qtd4.nullable().default(null),
  quantidade_venda: Qtd4.nullable().default(null),
  preco_unitario_centavos: Centavos,
  desconto_centavos: Centavos.default(0),
  total_informado_centavos: Centavos,
  aplicacao: z.string().max(1000).nullable().default(null),
});
export type ItemPedidoFdvEntrada = z.infer<typeof ItemPedidoFdvEntrada>;

/**
 * RF-PED-01: o `PedidoParaErp` já traduzido pelo `integracao-fdv` (T-0013 §5.2, coluna ERP).
 * O pedido do FDV já vem aprovado na origem e entra no ERP como `aprovado`, sem análise de crédito nem nova aprovação:
 * `recebido@1` com `pendencias: []` e `aprovado@1` com `automatica: true`, na mesma transação.
 * O total é sempre recalculado pelos itens; `total_informado_centavos` (e o do item) só fica guardado.
 */
export const PedidoFdvEntrada = z.object({
  pedido_uuid: Uuid,
  cliente_id: Uuid,
  vendedor_id: Uuid.nullable().default(null),
  filial_id: Uuid,
  condicao_pagamento_id: Uuid.nullable().default(null),
  /** UTC, ISO 8601. */
  emitido_em: z.string().datetime(),
  aprovado_origem_em: z.string().datetime().nullable().default(null),
  observacao: z.string().max(500).nullable().default(null),
  frete: Frete.nullable().default(null),
  endereco_entrega: EnderecoEntrega.nullable().default(null),
  total_informado_centavos: Centavos,
  itens: z.array(ItemPedidoFdvEntrada).min(1).max(500),
});
export type PedidoFdvEntrada = z.infer<typeof PedidoFdvEntrada>;

/** Recusa do recebimento do FDV (decisão de 21/11/2026, 23h10): problema de cadastro; a T-0016 devolve `rejeitado_erp`. */
export const CodigoRecusaRecebimento = z.enum([
  'modulo_pedido_inativo',
  'cliente_inexistente',
  'cliente_inativo',
  'produto_inexistente',
  'produto_inativo',
  'filial_inexistente',
  'filial_nao_emissora',
  'condicao_ausente',
  'condicao_inexistente',
  'condicao_inativa',
  'item_incoerente',
]);
export type CodigoRecusaRecebimento = z.infer<typeof CodigoRecusaRecebimento>;

export const ResultadoRecebimentoFdv = z.discriminatedUnion('resultado', [
  // Criado: o pedido do FDV entra `aprovado`, ou `em_analise` com prazo incompleto ou não permitido ao cliente (RN-PED-07, emenda de 24/11). Repetido: devolve o status atual do pedido já existente.
  z.object({ resultado: z.literal('criado'), pedido_id: Uuid, numero: z.number().int().positive(), status: z.enum(['aprovado', 'em_analise']) }),
  z.object({ resultado: z.literal('repetido'), pedido_id: Uuid, numero: z.number().int().positive(), status: StatusPedido }),
  // `item_incoerente`: desconto maior que o valor do item (`verificarItens`) ou fração fora de KG e M (RN-CAD-17, com `motivo`).
  z.object({ resultado: z.literal('recusado'), codigo: CodigoRecusaRecebimento, motivo: z.string().optional() }),
]);
export type ResultadoRecebimentoFdv = z.infer<typeof ResultadoRecebimentoFdv>;

export const AprovarEntrada = z.object({ justificativa: z.string().trim().min(1).max(500).optional() });
export type AprovarEntrada = z.infer<typeof AprovarEntrada>;
export const RecusarEntrada = z.object({ motivo_codigo: MotivoRecusa, motivo_texto: MotivoTexto }).superRefine(exigeTextoEmOutro);
export type RecusarEntrada = z.infer<typeof RecusarEntrada>;
export const CancelarEntrada = z.object({ motivo_codigo: MotivoCancelamento, motivo_texto: MotivoTexto }).superRefine(exigeTextoEmOutro);
export type CancelarEntrada = z.infer<typeof CancelarEntrada>;

// ---- Retratos dos cadastros (pick dos contratos; sem custo) ----
export const ClienteParaPedido = ClienteSchema.pick({
  id: true,
  tipo_pessoa: true,
  documento: true,
  razao_social: true,
  nome_fantasia: true,
  ind_ie_dest: true,
  ie: true,
  limite_credito_centavos: true,
  prazo_medio_dias: true,
  condicao_pagamento_id: true,
  tabela_preco_id: true,
  filial_id: true,
  vendedor_id: true,
  inativo: true,
}).extend({
  /** O `id` do endereço (T-0009, C-3) é o que `endereco_entrega_id` do pedido manual aponta; ausente = não dá para escolher por id. */
  enderecos: z.array(EnderecoClienteSchema.extend({ id: Uuid.optional(), municipio_nome: z.string().nullable().optional() })).min(1),
});
export type ClienteParaPedido = z.infer<typeof ClienteParaPedido>;
export const ProdutoParaPedido = ProdutoSchema.pick({
  id: true,
  codigo: true,
  descricao: true,
  unidade_comercial: true,
  ean: true,
  ncm: true,
  origem: true,
  inativo: true,
}).extend({ unidades: z.array(z.object({ unidade: z.string(), fator: Qtd4 }).passthrough()).default([]) });
export type ProdutoParaPedido = z.infer<typeof ProdutoParaPedido>;

// ---- Retratos gravados no pedido ----
export const ClienteRetrato = z.object({
  tipo_pessoa: z.enum(['PJ', 'PF']),
  documento: z.string(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  ie: z.string().nullable(),
  ind_ie_dest: z.enum(['1', '2', '9']),
  /** Endereço principal do destinatário (necessário à NF-e). */
  endereco: EnderecoClienteSchema.pick({
    logradouro: true,
    numero: true,
    complemento: true,
    bairro: true,
    municipio_ibge: true,
    uf: true,
    cep: true,
    pais_bacen: true,
  }).extend({ municipio_nome: z.string().nullable().optional() }),
});
export type ClienteRetrato = z.infer<typeof ClienteRetrato>;
export const ProdutoRetrato = z.object({
  codigo: z.string(),
  descricao: z.string(),
  unidade_comercial: z.string(),
  ean: z.string().nullable(),
  ncm: z.string(),
  /** Origem da mercadoria (NF-e), do cadastro do produto (aditivo no @1, T-0021). */
  origem: ProdutoSchema.shape.origem,
});
export type ProdutoRetrato = z.infer<typeof ProdutoRetrato>;

const ItemAprovado = z.object({
  sequencia: z.number().int().min(1),
  produto_id: Uuid,
  produto_retrato: ProdutoRetrato,
  quantidade: Qtd4,
  preco_unitario_centavos: Centavos,
  desconto_centavos: Centavos,
  total_centavos: Centavos,
});

/** T-0013 §8.1: o pedido inteiro, para o faturamento montar a fila "a faturar" sem ler o schema `pedido`. */
export const PedidoAprovado = z.object({
  condicao_pagamento_id: Uuid.nullable(),
  /** Da condição de pagamento lida na aprovação (aditivo no @1, T-0021); sem condição, os três são nulos. */
  forma_tpag: z.string().regex(/^\d{2}$/).nullable().default(null),
  forma_codigo: z.string().nullable().default(null),
  forma_nome: z.string().nullable().default(null),
  tabela_preco_id: Uuid.nullable(),
  emitido_em: z.string().datetime(),
  observacao: z.string().nullable(),
  /** Dado pessoal: só aqui e na tabela `pedido.pedido` (P9). */
  cliente_retrato: ClienteRetrato,
  endereco_entrega: EnderecoEntrega.nullable(),
  frete: Frete.nullable(),
  itens: z.array(ItemAprovado).min(1),
  total_centavos: Centavos,
});
export type PedidoAprovado = z.infer<typeof PedidoAprovado>;

// ---- Detalhe e lista (API) ----
const ItemPedido = ItemAprovado.extend({
  unidade_venda: z.string().nullable(),
  preco_tabela_centavos: Centavos.nullable(),
  desconto_maximo_bp: z.number().int().min(0).max(10_000).nullable(),
  total_informado_centavos: Centavos.nullable(),
  quantidade_faturada: Qtd4,
  aplicacao: z.string().nullable(),
});
export type ItemPedido = z.infer<typeof ItemPedido>;

export const HistoricoPedido = z.object({
  de: StatusPedido.nullable(),
  para: StatusPedido,
  ator_tipo: z.enum(['usuario', 'sistema']),
  ator_id: Uuid.nullable(),
  motivo_codigo: z.string().nullable(),
  motivo_texto: z.string().nullable(),
  ocorrido_em: z.string().datetime(),
});
export type HistoricoPedido = z.infer<typeof HistoricoPedido>;

export const DecisaoPedido = z.object({
  decisao: z.enum(['aprovado', 'recusado']),
  automatica: z.boolean(),
  decidido_por: Uuid.nullable(),
  perfil: z.string().nullable(),
  pendencias_aceitas: z.array(Pendencia),
  justificativa: z.string().nullable(),
  motivo_codigo: z.string().nullable(),
  motivo_texto: z.string().nullable(),
  decidido_em: z.string().datetime(),
});
export type DecisaoPedido = z.infer<typeof DecisaoPedido>;

export const PedidoLista = z.object({
  id: Uuid,
  numero: z.number().int().positive(),
  origem: OrigemPedido,
  status: StatusPedido,
  filial_id: Uuid,
  cliente_id: Uuid,
  cliente_razao_social: z.string(),
  vendedor_id: Uuid.nullable(),
  emitido_em: z.string().datetime(),
  total_centavos: Centavos,
  pendencias: z.number().int().min(0),
});
export type PedidoLista = z.infer<typeof PedidoLista>;

export const Pedido = PedidoAprovado.omit({ itens: true }).extend({
  /** `documento` nulo = o perfil (vendedor) não pode ver o documento do cliente (LGPD). */
  cliente_retrato: ClienteRetrato.extend({ documento: z.string().nullable() }),
  id: Uuid,
  numero: z.number().int(),
  origem: OrigemPedido,
  pedido_uuid: Uuid.nullable(),
  external_id: z.string().nullable(),
  status: StatusPedido,
  filial_id: Uuid,
  cliente_id: Uuid,
  vendedor_id: Uuid.nullable(),
  total_informado_centavos: Centavos.nullable(),
  valor_faturado_centavos: Centavos,
  aprovado_origem_em: z.string().datetime().nullable(),
  itens: z.array(ItemPedido),
  pendencias: z.array(PendenciaDetalhada),
  historico: z.array(HistoricoPedido),
  decisao: DecisaoPedido.nullable(),
  updated_at: z.string().datetime(),
});
export type Pedido = z.infer<typeof Pedido>;

// ---- Eventos pedido.pedido.*@1 (T-0013 §8; payload sem dado pessoal, exceto o retrato em PedidoAprovado, P9) ----
export const EVENTO_PEDIDO_RECEBIDO = 'pedido.pedido.recebido@1' as const;
export const EVENTO_PEDIDO_APROVADO = 'pedido.pedido.aprovado@1' as const;
export const EVENTO_PEDIDO_RECUSADO = 'pedido.pedido.recusado@1' as const;
export const EVENTO_PEDIDO_CANCELADO = 'pedido.pedido.cancelado@1' as const;
export const EVENTO_PEDIDO_FATURADO = 'pedido.pedido.faturado@1' as const;

export const PedidoEventoBase = z.object({
  pedido_id: Uuid,
  numero: z.number().int().positive(),
  origem: OrigemPedido,
  pedido_uuid: Uuid.nullable(),
  status: StatusPedido,
  status_anterior: StatusPedido.nullable(),
  filial_id: Uuid,
  cliente_id: Uuid,
  vendedor_id: Uuid.nullable(),
  total_centavos: Centavos,
});
export type PedidoEventoBase = z.infer<typeof PedidoEventoBase>;

export const PedidoRecebidoV1 = PedidoEventoBase.extend({ pendencias: z.array(CodigoPendencia) });
export type PedidoRecebidoV1 = z.infer<typeof PedidoRecebidoV1>;
export const PedidoAprovadoV1 = PedidoEventoBase.extend({ automatica: z.boolean(), pedido: PedidoAprovado });
export type PedidoAprovadoV1 = z.infer<typeof PedidoAprovadoV1>;
/** P9: texto livre só existe quando o motivo é `outro`. */
const textoSoEmOutro = (v: { motivo_codigo: string; motivo_texto: string | null }, ctx: z.RefinementCtx) => {
  if (v.motivo_codigo !== 'outro' && v.motivo_texto !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo_texto'], message: "motivo_texto só vale quando o motivo é 'outro'" });
  }
};
export const PedidoRecusadoV1 = PedidoEventoBase.extend({ motivo_codigo: MotivoRecusa, motivo_texto: z.string().nullable() }).superRefine(textoSoEmOutro);
export type PedidoRecusadoV1 = z.infer<typeof PedidoRecusadoV1>;
export const PedidoCanceladoV1 = PedidoEventoBase.extend({ motivo_codigo: MotivoCancelamento, motivo_texto: z.string().nullable() }).superRefine(textoSoEmOutro);
export type PedidoCanceladoV1 = z.infer<typeof PedidoCanceladoV1>;
/**
 * Cópia do `CHAVE_ACESSO_REGEX` de `modules/faturamento/contracts` (CNPJ alfanumérico: 6 dígitos, 12 de A-Z/0-9, 26 dígitos).
 * Não se importa do faturamento, que depende do pedido; mantenha igual à origem.
 */
const CHAVE_ACESSO_REGEX = /^\d{6}[A-Z0-9]{12}\d{26}$/;

export const PedidoFaturadoV1 = PedidoEventoBase.extend({
  ambiente: z.enum(['homologacao', 'producao']),
  /** Faturamento real com NF-e simulada (T-0015): copiado da nota. Para o FDV tudo é real. */
  conta_como_real: z.boolean().optional(),
  nota: z.object({
    id: Uuid,
    numero: z.number().int(),
    serie: z.number().int(),
    chave: z.string().regex(CHAVE_ACESSO_REGEX),
    emitida_em: z.string().datetime(),
    total_centavos: Centavos,
  }),
  itens_faturados: z.array(z.object({ sequencia: z.number().int().min(1), produto_id: Uuid, quantidade: Qtd4, valor_centavos: Centavos })),
});
export type PedidoFaturadoV1 = z.infer<typeof PedidoFaturadoV1>;

/** Nome do evento → schema do payload (mesmo formato do cadastros). */
export const EVENTOS = {
  [EVENTO_PEDIDO_RECEBIDO]: PedidoRecebidoV1,
  [EVENTO_PEDIDO_APROVADO]: PedidoAprovadoV1,
  [EVENTO_PEDIDO_RECUSADO]: PedidoRecusadoV1,
  [EVENTO_PEDIDO_CANCELADO]: PedidoCanceladoV1,
  [EVENTO_PEDIDO_FATURADO]: PedidoFaturadoV1,
} as const;
export type NomeEventoPedido = keyof typeof EVENTOS;

/** Porta `SituacaoPedidoParaFaturar` (T-0021): status e saldo por item, lidos com `FOR SHARE` na transação da nota. */
export const SituacaoPedidoParaFaturar = z.object({
  status: StatusPedido,
  itens: z.array(z.object({ sequencia: z.number().int().min(1), quantidade: Qtd4, quantidade_faturada: Qtd4 })),
});
export type SituacaoPedidoParaFaturar = z.infer<typeof SituacaoPedidoParaFaturar>;
