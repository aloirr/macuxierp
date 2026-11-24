/**
 * Temporário: troca para @macuxierp/platform-sdk/hub-v1 quando o nuvem/T-0057-sdk-hub-v1-3 entrar (SHA ~07h25).
 *
 * Adaptador ÚNICO de tipos do Conector (ADR 0014 §6 item 2): todo o código e os testes importam daqui, nunca de outro lugar.
 * No FDV 1.5.0 (aloirr/macuxifdv@c460e92) estes nomes vinham de `@macuxi/integracao/contracts`; aqui eles são definidos
 * localmente, no formato da `/entrada/v1` do Macuxi ERP (o mesmo contrato do Hub `/integracao/v1`, ADR 0014 §2), com os
 * payloads dos 10 cadastros da F2 copiados de `modules/integracao-fdv/contracts/hub.ts` (C-6) e o resto reconstruído pelos usos
 * do Conector e pelos testes. Cada export diz a origem prevista:
 *   - `(SDK: <nome>)`: vem do `@macuxierp/platform-sdk/hub-v1` na troca, com o nome indicado;
 *   - `(local)`: continua no Conector (não existe na `/entrada/v1` do ERP ou só o Conector usa).
 * O teste `test/contrato.test.ts` trava as constantes que já existem no SDK (`ENTIDADES_ENVIO_FDV`, `LIMITE_REGISTROS_LOTE_FDV`).
 *
 * Regras: dinheiro em centavos inteiros (`_cents`); data-hora ISO 8601 UTC com `Z`; data civil `AAAA-MM-DD`; quantidade é número
 * finito (pode ser fracionária); objetos não estritos (campo desconhecido é descartado, compatível para frente).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------------------------
// Constantes do contrato
// ---------------------------------------------------------------------------------------------------------------------

/** Versão do contrato que o Conector fala. (SDK: VERSAO_CONTRATO_HUB) */
export const VERSAO_CONTRATO = 'v1' as const;

/** Prefixo padrão das rotas no Macuxi ERP (`hub.prefixo` do conector.json; ADR 0014 §6 item 1). (local) */
export const PREFIXO_PADRAO = '/entrada/v1' as const;

/** Cabeçalhos de identificação do Conector em toda chamada (T-0023 do FDV). (SDK: CABECALHO_CONECTOR_ID / CABECALHO_CONECTOR_VERSAO) */
export const CABECALHO_CONECTOR_ID = 'X-Macuxi-Conector-Id' as const;
export const CABECALHO_CONECTOR_VERSAO = 'X-Macuxi-Conector-Versao' as const;

/** Tamanho máximo do `external_id` (D-3 da T-0027 do FDV). (SDK: EXTERNAL_ID_MAX) */
export const EXTERNAL_ID_MAX = 200;

/** Registros por lote (doc 06; igual a `LIMITE_REGISTROS_LOTE_FDV` do SDK). (SDK: LIMITE_REGISTROS_LOTE) */
export const LIMITE_REGISTROS_LOTE = 5000;

/** Linhas inválidas detalhadas por lote (RN-INT-03, emenda da T-0048 do FDV). (SDK: LIMITE_LINHAS_INVALIDAS_PADRAO) */
export const LIMITE_LINHAS_INVALIDAS_PADRAO = 500;

/** Teto de `?limite_erros=` em `GET /lotes/{id}` (5.000 registros + 500 inválidas; D-5 da T-0027 do FDV). (SDK: LIMITE_ERROS_RESPOSTA_MAX) */
export const LIMITE_ERROS_RESPOSTA_MAX = 5500;

/**
 * Entidades da `/entrada/v1`, na ordem de carga (RN-INF-02): os 10 cadastros da F2 (`ENTIDADES_ENVIO_FDV` do SDK, ADR 0014 §2).
 * Os outros 6 do kit do FDV (catalogo_no, transportadora, tabela_escalonada, rota, titulo, nota) ficam fora da fase.
 * (SDK: ENTIDADES_HUB_F2)
 */
export const ENTIDADES = [
  'filial',
  'vendedor',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
  'cliente_endereco',
] as const;
export const EntidadeSchema = z.enum(ENTIDADES);
export type Entidade = z.infer<typeof EntidadeSchema>;

/** Ordem de carga (RN-INT-04 do FDV / RN-INF-02 do ERP): a própria lista das entidades. (SDK: ORDEM_CARGA_ENTIDADES) */
export const ORDEM_CARGA_ENTIDADES: readonly Entidade[] = ENTIDADES;

/** Entidade como o ERP pode devolver nas respostas (a F4 acrescenta título e nota). (SDK: EntidadeHub) */
const EntidadeResposta = z.enum([...ENTIDADES, 'titulo', 'nota']);

// ---------------------------------------------------------------------------------------------------------------------
// Blocos comuns
// ---------------------------------------------------------------------------------------------------------------------

const Texto = (max: number) => z.string().min(1).max(max);
const ExternalId = z.string().min(1).max(EXTERNAL_ID_MAX);
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Quantidade = z.number().finite();
const Centavos = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Instante = z.string().datetime();
const InstanteNulo = Instante.nullable();
const Uuid = z.string().uuid();
const ConectorId = z.string().min(1).max(100);
/** A-04 (RN-CORE-19 do FDV): sigla de medida = 1 a 4 letras maiúsculas. */
const SiglaMedida = z.string().regex(/^[A-Z]{1,4}$/);

/** Semver estrito `MAIOR.MENOR.PATCH` com pré-lançamento opcional. (SDK: REGEX_SEMVER) */
export const REGEX_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/** (SDK: VersaoSemver) */
export const VersaoSemver = z.string().regex(REGEX_SEMVER);

/** Par do cursor do delta (RN-INT-05): instante UTC e `external_id` em ordem ordinal. (SDK: CursorHub) */
export const Cursor = z.object({ alterado_em: Instante, external_id: ExternalId });
export type Cursor = z.infer<typeof Cursor>;

export const ModoLote = z.enum(['completo', 'delta']);
export type ModoLote = z.infer<typeof ModoLote>;
const SessaoLote = z.object({ id: Uuid, parte: z.number().int().min(1), ultimo: z.boolean() });

// ---------------------------------------------------------------------------------------------------------------------
// Payloads dos 10 cadastros (cópia de modules/integracao-fdv/contracts/hub.ts) + `alterado_em` do registro do lote
// ---------------------------------------------------------------------------------------------------------------------

const Base = z.object({ external_id: ExternalId, ativo: z.boolean() });

const FilialHub = Base.extend({
  codigo: Texto(20),
  nome: Texto(60),
  cidade: Texto(80).optional(),
  uf: z.string().regex(/^[A-Z]{2}$/).optional(),
  cnpj: Texto(18).optional(),
  logradouro: Texto(160).optional(),
  numero: Texto(20).optional(),
  complemento: Texto(80).optional(),
  bairro: Texto(80).optional(),
  cep: z.string().regex(/^\d{8}$/).optional(),
  telefone: Texto(30).optional(),
});
const VendedorHub = Base.extend({ nome: Texto(80), filial_external_id: ExternalId.optional() });
const FormaPagamentoHub = Base.extend({ codigo: Texto(30), nome: Texto(60) });
const PrazoPagamentoHub = Base.extend({
  forma_external_id: ExternalId,
  codigo: Texto(20),
  /**
   * `"28/56"`; à vista = `"0"`. A view do kit do FDV entrega a lista em JSON (`[28,56]`, `transformar: json`): ela é aceita e
   * normalizada para o texto do contrato do ERP (inferido; o SDK precisa aceitar a mesma forma na troca).
   */
  parcelas_dias: z.union([
    z.string().regex(/^\d{1,3}(\/\d{1,3})*$/),
    z
      .array(z.number().int().min(0).max(999))
      .min(1)
      .transform((dias) => dias.join('/')),
  ]),
  descricao: Texto(60).optional(),
});
/** Sem custo e sem preço de venda, por construção (M8). */
const ProdutoHub = Base.extend({ sku: Texto(60), nome: Texto(120), unidade: SiglaMedida, ean: z.string().optional(), marca: Texto(60).optional() });
const ProdutoUnidadeHub = Base.extend({ produto_external_id: ExternalId, unidade: SiglaMedida, fator: Quantidade.positive(), ean: z.string().optional(), padrao: z.boolean() });
const PrecoHub = Base.extend({
  tabela_external_id: ExternalId,
  tabela_nome: Texto(120),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.optional(),
  produto_external_id: ExternalId,
  preco_cents: Centavos,
  filial_external_id: ExternalId.optional(),
});
const EstoqueHub = Base.extend({
  deposito_external_id: ExternalId,
  deposito_nome: Texto(120).optional(),
  produto_external_id: ExternalId,
  saldo: Quantidade,
  filial_external_id: ExternalId,
});
const EnderecoClienteHub = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  cep: z.string().optional(),
});
/** Minimização (M9): sem e-mail, contato, coordenadas nem observação. */
const ClienteHub = Base.extend({
  razao_social: Texto(60),
  nome_fantasia: Texto(60).optional(),
  documento: z.string().optional(),
  inscricao_estadual: z.string().optional(),
  vendedor_external_id: ExternalId.optional(),
  filial_external_id: ExternalId,
  endereco: EnderecoClienteHub.optional(),
  limite_credito_cents: Centavos,
  formas_pagamento: z.array(z.string()).optional(),
  prazo_medio_max_dias: z.number().int().min(0).optional(),
});
const ClienteEnderecoHub = Base.extend({
  cliente_external_id: ExternalId,
  logradouro: Texto(60),
  cidade: Texto(60),
  uf: z.string().regex(/^[A-Z]{2}$/),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cep: z.string().optional(),
  tipo: z.enum(['principal', 'entrega', 'cobranca']),
  principal: z.boolean(),
});

/** Registro canônico por entidade, como vai em `registros` do lote: o payload + `alterado_em` (UTC, ms). (SDK: PAYLOADS_HUB, + `alterado_em`) */
const comAlteradoEm = <T extends z.AnyZodObject>(s: T) => s.extend({ alterado_em: Instante });
export const SCHEMA_REGISTRO = {
  filial: comAlteradoEm(FilialHub),
  vendedor: comAlteradoEm(VendedorHub),
  forma_pagamento: comAlteradoEm(FormaPagamentoHub),
  prazo_pagamento: comAlteradoEm(PrazoPagamentoHub),
  produto: comAlteradoEm(ProdutoHub),
  produto_unidade: comAlteradoEm(ProdutoUnidadeHub),
  preco: comAlteradoEm(PrecoHub),
  estoque: comAlteradoEm(EstoqueHub),
  cliente: comAlteradoEm(ClienteHub),
  cliente_endereco: comAlteradoEm(ClienteEnderecoHub),
} as const satisfies Record<Entidade, z.ZodTypeAny>;

// ---------------------------------------------------------------------------------------------------------------------
// Lote: envelope, linhas inválidas, aceite, resultado e cursor
// ---------------------------------------------------------------------------------------------------------------------

/** Códigos de erro por linha (RN-INT-03 do FDV); os dois últimos são reprocessáveis. (SDK: CODIGOS_ERRO_LINHA_HUB) */
export const CODIGOS_ERRO_LINHA = [
  'registro_invalido',
  'external_id_invalido',
  'campo_obrigatorio',
  'tipo_invalido',
  'formato_invalido',
  'valor_fora_da_faixa',
  'valor_nao_permitido',
  'campo_desconhecido',
  'regra_invalida',
  'referencia_ausente',
  'falha_processamento',
] as const;

/**
 * Linha recusada no próprio Conector e informada em `linhas_invalidas` (T-0023/T-0027 do FDV): sem valor de campo. Sem
 * `external_id` (ausente ou acima de 200) o ERP não inativa nada na sessão (RN-INT-06). (SDK: LinhaInvalidaConector)
 */
export const LinhaInvalidaConector = z.object({
  external_id: ExternalId.nullish(),
  codigo: z.enum(CODIGOS_ERRO_LINHA),
  campo: z.string().max(100).nullish(),
  mensagem: z.string().min(1).max(300),
});
export type LinhaInvalidaConector = z.infer<typeof LinhaInvalidaConector>;

/**
 * Corpo de `POST {prefixo}/lotes`. `registros` vazio só com linhas inválidas (exceção da RN-INT-01, T-0027 do FDV); quem confere
 * limite, entidade da fase e sessão é o ERP (recusa 422 do envelope inteiro). (SDK: LoteEnvelope)
 */
export const LoteEnvelope = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  entidade: z.string().min(1).max(60),
  modo: ModoLote,
  sessao: SessaoLote.optional(),
  cursor: Cursor.nullish(),
  enviado_em: Instante,
  conector_id: ConectorId.optional(),
  versao_conector: z.string().min(1).max(40).optional(),
  linhas_invalidas: z.array(LinhaInvalidaConector).max(LIMITE_LINHAS_INVALIDAS_PADRAO).optional(),
  linhas_invalidas_omitidas: z.number().int().min(0).optional(),
  registros: z.array(z.record(z.string(), z.unknown())),
});
export type LoteEnvelope = z.infer<typeof LoteEnvelope>;

/** Resposta 202 de `POST {prefixo}/lotes`. (SDK: LoteAceito) */
export const LoteAceito = z.object({
  lote_id: Uuid,
  status: z.literal('recebido'),
  entidade: EntidadeResposta,
  modo: ModoLote,
  recebidos: z.number().int().positive(),
  repetido: z.boolean().nullish(),
  consulta: z.string(),
});
export type LoteAceito = z.infer<typeof LoteAceito>;

/** Recusa do envelope inteiro (400/413/422, RN-INT-01): lista de erros com código do catálogo. (SDK: RecusaEnvelope) */
export const RecusaEnvelope = z.object({
  erros: z.array(z.object({ codigo: z.string().min(1).max(60), campo: z.string().nullish(), mensagem: z.string() })).min(1),
});
export type RecusaEnvelope = z.infer<typeof RecusaEnvelope>;

/** Linha com erro no resultado: sem valor de campo nem dado pessoal. (SDK: LinhaErroHub) */
export const LinhaErro = z.object({
  indice: z.number().int().nonnegative(),
  external_id: z.string().max(EXTERNAL_ID_MAX).nullable(),
  codigo: z.enum(CODIGOS_ERRO_LINHA),
  campo: z.string().nullable(),
  mensagem: z.string(),
  reprocessavel: z.boolean(),
  /** `conector` = veio em `linhas_invalidas`; ausente = validada no ERP. */
  origem: z.enum(['hub', 'conector']).nullish(),
});
export type LinhaErro = z.infer<typeof LinhaErro>;

const AvisoLinha = z.object({ indice: z.number().int().nonnegative(), external_id: z.string(), codigo: z.string(), mensagem: z.string() });

const ContagensLote = z.object({
  recebidas: z.number().int().nonnegative(),
  duplicadas_no_lote: z.number().int().nonnegative(),
  com_erro: z.number().int().nonnegative(),
  novas: z.number().int().nonnegative(),
  atualizadas: z.number().int().nonnegative(),
  inalteradas: z.number().int().nonnegative(),
  obsoletas: z.number().int().nonnegative().default(0),
});

/** Situação da inativação no último lote da sessão completa (RN-INT-06; trava de 30%). */
const InativacaoLote = z.object({
  situacao: z.enum(['aplicada', 'aguardando_confirmacao', 'nao_aplicavel']),
  motivo: z.string().nullish(),
  candidatos: z.number().int().nonnegative().nullish(),
  percentual: z.number().nonnegative().nullish(),
});

/** Resultado de `GET {prefixo}/lotes/{id}`. (SDK: LoteResultado) */
export const LoteResultado = z.object({
  lote_id: Uuid,
  entidade: EntidadeResposta,
  modo: ModoLote,
  status: z.enum(['recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou']),
  contagens: ContagensLote,
  erros: z.array(LinhaErro),
  avisos: z.array(AvisoLinha),
  cursor: Cursor.nullable(),
  invalidas_omitidas: z.number().int().nonnegative().nullish(),
  erros_total: z.number().int().nonnegative().nullish(),
  erros_omitidos: z.number().int().nonnegative().nullish(),
  inativacao: InativacaoLote.nullish(),
  inativadas: z.number().int().nonnegative().default(0),
  recebido_em: Instante,
  concluido_em: InstanteNulo,
});
export type LoteResultado = z.infer<typeof LoteResultado>;

/** `GET {prefixo}/cursores/{entidade}`. (SDK: CursorEntidade) */
export const CursorEntidade = z.object({ entidade: EntidadeResposta, cursor: Cursor.nullable(), atualizado_em: InstanteNulo });
export type CursorEntidade = z.infer<typeof CursorEntidade>;

// ---------------------------------------------------------------------------------------------------------------------
// Versão, pacote e sinal de vida
// ---------------------------------------------------------------------------------------------------------------------

/** Pacote do Conector anunciado pela política (onde baixar e como conferir). (SDK: PacoteConector) */
export const PacoteConector = z.object({
  versao: VersaoSemver,
  url: z.string().url().nullish(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  assinatura: z.string().min(1).nullish(),
  chave_publica_id: z.string().min(1).max(100).nullish(),
});
export type PacoteConector = z.infer<typeof PacoteConector>;

/** Política de versão: abaixo da mínima o Conector para; abaixo da recomendada só avisa. (SDK: PoliticaVersaoConector) */
export const PoliticaVersaoConector = z.object({
  versao_minima: VersaoSemver,
  versao_recomendada: VersaoSemver,
  mensagem: z.string().max(300).nullish(),
  pacote: PacoteConector.nullish(),
});
export type PoliticaVersaoConector = z.infer<typeof PoliticaVersaoConector>;

/** Resposta 200 de `POST {prefixo}/sinal`; `politica_versao` ausente = sem restrição. (SDK: RespostaSinal) */
export const RespostaSinal = z.object({
  politica_versao: PoliticaVersaoConector.nullish(),
  conector_id: ConectorId.nullish(),
  recebido_em: Instante.nullish(),
});
export type RespostaSinal = z.infer<typeof RespostaSinal>;

/**
 * Resumo do último resultado da atualização automática no sinal (T-0100 do FDV). Desligada no Macuxi ERP (ADR 0014 §6 item 3):
 * o campo só sairia com resultado, o que não acontece; a `/entrada/v1` descarta. (local)
 */
export const AtualizacaoConector = z.object({
  resultado: z.enum(['atualizado', 'mantido', 'revertido']),
  codigo: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/).nullable(),
  versao_de: VersaoSemver,
  versao_para: VersaoSemver.nullable(),
  em: Instante,
  mensagem: z.string().min(1).max(300),
});
export type AtualizacaoConector = z.infer<typeof AtualizacaoConector>;

/** Corpo de `POST {prefixo}/sinal` (batimento de vida, 1 min). Sem dado pessoal. (SDK: SinalConector, o `CorpoSinal` do SDK) */
export const SinalConector = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  conector_id: ConectorId,
  versao_conector: VersaoSemver,
  em: Instante,
  fila: z.array(z.object({ estado: z.string(), lotes: z.number().int().min(0), linhas: z.number().int().min(0), maisAntigo: InstanteNulo })),
  entidades: z.array(
    // `fase` é o texto do `conector status` ("carga completa", "delta", "ainda não iniciada"), como no FDV 1.5.0
    z.object({ entidade: z.string().min(1).max(60), fase: z.string().min(1).max(40), ultimo_sucesso: InstanteNulo, bloqueada: z.boolean(), lotes_na_fila: z.number().int().min(0) }),
  ),
  parado_por_versao: z.boolean().optional(),
  atualizacao: AtualizacaoConector.optional(),
});
export type SinalConector = z.infer<typeof SinalConector>;

// ---------------------------------------------------------------------------------------------------------------------
// Pedidos (mão dupla, ADR 0014 §6 item 5): o que o ERP entrega e o retorno do Conector
// ---------------------------------------------------------------------------------------------------------------------

const Uf = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());

/** Item do pedido (RN-INT-08 do FDV). */
const ItemPedidoParaErp = z.object({
  sequencia: z.number().int().min(1),
  produto_external_id: ExternalId,
  quantidade: Quantidade.positive(),
  preco_unitario_cents: Centavos,
  desconto_cents: Centavos.default(0),
  total_cents: Centavos,
});

/** Transportadora do frete FOB (RN-VEN-16 do FDV): cadastrada (com id e chave) ou digitada no pedido. */
const TransportadoraPedido = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('cadastrada'), id: Uuid, external_id: ExternalId.nullish(), nome: Texto(120), cnpj: z.string().max(18).nullish(), telefone: z.string().max(30).nullish() }),
  z.object({ tipo: z.literal('digitada'), nome: Texto(120), cnpj: z.string().max(18).nullish(), telefone: z.string().max(30).nullish() }),
]);

const FretePedido = z.discriminatedUnion('modalidade', [
  z.object({ modalidade: z.literal('CIF') }),
  z.object({ modalidade: z.literal('FOB'), transportadora: TransportadoraPedido.nullish() }),
]);

/** Endereço de entrega (RN-VEN-17 do FDV): `external_id` nulo = endereço editado no pedido (o SQL usa os textos). */
const EnderecoEntregaPedido = z.object({
  origem: z.enum(['erp', 'editado']).nullish(),
  external_id: ExternalId.nullish(),
  logradouro: z.string().max(160).nullish(),
  numero: z.string().max(20).nullish(),
  complemento: z.string().max(80).nullish(),
  bairro: z.string().max(80).nullish(),
  cidade: z.string().max(80).nullish(),
  uf: Uf.nullish(),
  cep: z.string().max(9).nullish(),
  principal: z.boolean().nullish(),
});

/** Pagamento do pedido (RN-VEN-24 do FDV); `percentual_ajuste` é só informativo (RN-INT-15). */
const PagamentoPedido = z.object({
  forma_codigo: Texto(30),
  forma_external_id: ExternalId.nullish(),
  prazo_codigo: Texto(20),
  prazo_external_id: ExternalId.nullish(),
  parcelas_dias: z.array(z.number().int().min(0).max(999)).min(1),
  prazo_medio_dias: z.number().int().min(0),
  percentual_ajuste: z.number().finite().nullish(),
});

/** Filial do pedido (RN-CORE-39 do FDV): sem `external_id` = filial padrão do ERP. */
const FilialPedido = z.object({ codigo: Texto(20), external_id: ExternalId.nullish(), nome: z.string().max(60).nullish(), padrao: z.boolean().nullish() });

/** Pedido entregue em `GET {prefixo}/pedidos/pendentes` para gravar no banco do cliente. (SDK: PedidoParaErp) */
export const PedidoParaErp = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  pedido_uuid: Uuid,
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId,
  condicao_pagamento_erp: z.string().max(60).nullish(),
  criado_em: Instante,
  aprovado_em: Instante,
  observacao: z.string().max(500).nullish(),
  desconto_total_cents: Centavos.default(0),
  total_cents: Centavos,
  tentativa: z.number().int().min(1).default(1),
  filial: FilialPedido.nullish(),
  frete: FretePedido.nullish(),
  endereco_entrega: EnderecoEntregaPedido.nullish(),
  pagamento: PagamentoPedido.nullish(),
  itens: z.array(ItemPedidoParaErp).min(1).max(500),
});
export type PedidoParaErp = z.infer<typeof PedidoParaErp>;

/** Cancelamento feito no Macuxi devolvido ao banco do cliente (T-0114 do FDV). (SDK: CancelamentoParaErp) */
export const CancelamentoParaErp = z.object({
  pedido_uuid: Uuid,
  numero_erp: z.string().max(40).nullish(),
  motivo: z.string().max(300).nullish(),
  cancelado_em: Instante,
  tentativa: z.number().int().min(1).default(1),
});
export type CancelamentoParaErp = z.infer<typeof CancelamentoParaErp>;

/** Resposta de `GET {prefixo}/pedidos/pendentes`; `cancelamentos` só aparece quando há. (SDK: PedidosPendentes) */
export const PedidosPendentes = z.object({ pedidos: z.array(PedidoParaErp), cancelamentos: z.array(CancelamentoParaErp).optional() });
export type PedidosPendentes = z.infer<typeof PedidosPendentes>;

/** Item faturado numa nota (RN-INT-08; T-0023 do FDV). (SDK: ItemFaturado) */
export const ItemFaturado = z.object({ sequencia: z.number().int().min(1), produto_external_id: ExternalId, quantidade: Quantidade.positive(), valor_cents: Centavos });
export type ItemFaturado = z.infer<typeof ItemFaturado>;

/** Status do retorno do pedido (`cancelamento_recusado`: T-0114 do FDV). */
const StatusRetorno = z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado', 'cancelamento_recusado']);

/** Corpo de `POST {prefixo}/pedidos/{uuid}/retorno`. Faturamento exige a nota. Sem XML, sem dado pessoal. (SDK: RetornoErp) */
export const RetornoErp = z
  .object({
    versao_contrato: z.literal(VERSAO_CONTRATO),
    pedido_uuid: Uuid,
    status: StatusRetorno,
    numero_erp: z.string().min(1).max(40).optional(),
    motivo: z.string().max(300).optional(),
    nota: z.object({ numero: Texto(20), serie: z.string().max(10).optional(), emitida_em: Instante, total_cents: Centavos }).optional(),
    itens_faturados: z.array(ItemFaturado).min(1).optional(),
    ocorrido_em: Instante,
  })
  .superRefine((r, ctx) => {
    if ((r.status === 'faturado_parcial' || r.status === 'faturado_total') && !r.nota) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nota'], message: 'faturamento exige a nota' });
    }
  });
export type RetornoErp = z.infer<typeof RetornoErp>;

/** Resposta do retorno aceito (idempotente: `repetido` = o mesmo retorno já tinha chegado). (SDK: RetornoAceito) */
export const RetornoAceito = z.object({ pedido_uuid: Uuid, status: z.string(), repetido: z.boolean().nullish() });
export type RetornoAceito = z.infer<typeof RetornoAceito>;

// ---------------------------------------------------------------------------------------------------------------------
// Reconciliação (RN-INT-07 do FDV): NÃO existe na /entrada/v1 do ERP (ADR 0014 §2). O esquema recusa a seção; o código fica sem uso.
// ---------------------------------------------------------------------------------------------------------------------

/** Campo somado na soma de controle por entidade (`null` = só contagem). (local) */
export const CAMPO_SOMA_CONTROLE: Record<Entidade, string | null> = {
  filial: null,
  vendedor: null,
  forma_pagamento: null,
  prazo_pagamento: null,
  produto: null,
  produto_unidade: null,
  preco: 'preco_cents',
  estoque: 'saldo',
  cliente: 'limite_credito_cents',
  cliente_endereco: null,
};

/** Corpo de `POST /reconciliacoes` do FDV. (local) */
export const ReconciliacaoEnvio = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  entidade: EntidadeSchema,
  data_referencia: DataCivil,
  contagem: z.number().int().min(0),
  soma: z.number().finite().nullable(),
});
export type ReconciliacaoEnvio = z.infer<typeof ReconciliacaoEnvio>;
