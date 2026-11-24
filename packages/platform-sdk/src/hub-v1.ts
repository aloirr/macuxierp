/**
 * Contrato do Hub `/integracao/v1` do Macuxi FDV em Zod (ADR 0014 §2), único para os dois lados do ERP: o envio ao Hub
 * (`modules/integracao-fdv`, que passa a reexportar daqui), a futura `/entrada/v1` do cadastros e o `apps/conector`.
 * Conferido contra aloirr/macuxifdv@c460e92 (modules/integracao/contracts e apps/conector/src/hub, Conector 1.5.0).
 *
 * - Dinheiro em centavos inteiros, sufixo `_cents` (nunca float).
 * - Data-hora ISO 8601 em UTC, sempre com `Z` (`2026-11-23T14:00:00.000Z`); data civil `AAAA-MM-DD`.
 * - Quantidade (fator, saldo) é número finito, pode ser fracionária; nunca texto.
 * - Os objetos não são `strict`: campo desconhecido é descartado (compatibilidade para frente, RN-INT-09 do FDV).
 *
 * Fica fora do `export *` do `index.ts` (o schema `ClienteHub` colide com a porta HTTP `ClienteHub` de `./hub`): sai só pelo
 * subcaminho `@macuxierp/platform-sdk/hub-v1`. Envelope e payloads são o mesmo Zod de `modules/integracao-fdv/contracts/hub.ts`
 * (C-6, docs/desenho/T-0009.md §2); a resposta (lote aceito, resultado, cursor e sinal) vem do FDV, com os mesmos campos e limites.
 *
 * O `conector_id` do lote vem no cabeçalho HTTP `X-Macuxi-Conector-Id` (`CABECALHO_CONECTOR_ID`), como no FDV, e não no corpo:
 * o `LoteEnvelope` da ADR §2 é o `CorpoLote`.
 */
import { z } from 'zod';
import { ENTIDADES_ENVIO_FDV, LIMITE_REGISTROS_LOTE_FDV } from './portal-integracao';

/** As 12 entidades do Hub que o ERP alimenta: as 10 da F2 vêm do SDK (ADR 0013), título e nota são da F4. A ordem de carga é a `ORDEM_CARGA_ENTIDADES`. */
export const ENTIDADES_HUB = [...ENTIDADES_ENVIO_FDV, 'titulo', 'nota'] as const;
export const EntidadeHub = z.enum(ENTIDADES_HUB);
export type EntidadeHub = z.infer<typeof EntidadeHub>;
/** Entidades com contrato nesta fase (F2). */
export const ENTIDADES_HUB_F2 = ENTIDADES_HUB.slice(0, 10) as readonly EntidadeHub[];

/** Registros por lote do Hub (limite do contrato, doc 06): `CorpoLote`, a credencial (`ConfiguracaoEntrada`) e o `domain/lote` usam só esta constante. */
export const LIMITE_REGISTROS_LOTE = LIMITE_REGISTROS_LOTE_FDV;

/** Teto de bytes do corpo de `POST /entrada/v1/lotes` (ADR 0014 §3, o mesmo do Hub): acima dele, 413 sem lote criado. */
export const MAX_BYTES_LOTE_ENTRADA = 8 * 1024 * 1024;

/**
 * Ordem em que o Conector sobe as entidades da F2 (RN-INF-02): a referenciada antes de quem a referencia (filial antes do vendedor,
 * forma antes do prazo, produto antes da unidade, do preço e do estoque, cliente antes do endereço).
 */
export const ORDEM_CARGA_ENTIDADES = [
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
] as const satisfies readonly EntidadeHub[];

/** Versão do contrato do Hub que o ERP fala. */
export const VERSAO_CONTRATO_HUB = 'v1' as const;

/** Código de erro (linha ou lote): identificador do catálogo, nunca mensagem livre. */
export const CodigoErro = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
export type CodigoErro = z.infer<typeof CodigoErro>;

/** Nome do campo com erro (caminho do payload); igual à restrição do banco (0007). */
export const CampoErro = z.string().regex(/^[A-Za-z0-9_.[\]]{1,80}$/).nullable();

export const SituacaoEntidade = z.enum(['ok', 'pausada']);
export type SituacaoEntidade = z.infer<typeof SituacaoEntidade>;

/** A-04 (RN-CORE-19 do FDV): sigla de medida = 1 a 4 letras maiúsculas (`SIGLA_MEDIDA_FORMATO`); o Hub ainda confere se ela existe nas medidas do tenant. */
const SiglaMedida = z.string().regex(/^[A-Z]{1,4}$/);
const Texto = (max: number) => z.string().min(1).max(max);
/** Tamanho máximo do `external_id` do Hub (1 a 200 caracteres, comparado por bytes no FDV). */
export const EXTERNAL_ID_MAX = 200;
export const ExternalId = z.string().min(1).max(EXTERNAL_ID_MAX);
export type ExternalId = z.infer<typeof ExternalId>;
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Quantidade do Hub (`Quantidade` do `base.ts` do FDV): número finito, pode ser fracionário (P-1: não é texto). */
const Quantidade = z.number().finite();
/** Centavos inteiros ≥ 0, até `Number.MAX_SAFE_INTEGER` (o mesmo teto do `CentavosLido` do `integracao-fdv`). */
const Centavos = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Instante = z.string().datetime();
const InstanteNulo = Instante.nullable();
const Uuid = z.string().uuid();
/** `conector_id` (ADR 0014 §4): a mesma regra do Conector. */
export const ConectorIdHub = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);

/** Nome em minúsculas, como o Fastify e o `fetch` leem. */
export const CABECALHO_CONECTOR_ID = 'x-macuxi-conector-id';

/** Campos de todo registro, além dos da entidade. `alterado_em` fica fora do hash (RN-INF-03). */
const Base = z.object({ external_id: ExternalId, ativo: z.boolean() });

export const FilialHub = Base.extend({
  codigo: Texto(20),
  nome: Texto(60),
  cidade: Texto(80).optional(),
  uf: z.string().regex(/^[A-Z]{2}$/).optional(),
  // RN-CORE-39 do FDV (A-01): a carga exige CNPJ com dígito válido, endereço, cidade e UF; no shape são opcionais (aditivo no v1 do FDV).
  // Limites do FDV (`LIMITES_FILIAL`): cnpj 18, logradouro 160, numero 20, complemento 80, bairro 80, cep 9, telefone 30. O ERP envia CNPJ
  // e CEP só com os caracteres úteis (sem máscara); `telefone` não existe no evento da filial do cadastros e não é preenchido.
  cnpj: Texto(18).optional(),
  logradouro: Texto(160).optional(),
  numero: Texto(20).optional(),
  complemento: Texto(80).optional(),
  bairro: Texto(80).optional(),
  cep: z.string().regex(/^\d{8}$/).optional(),
  telefone: Texto(30).optional(),
});
export type FilialHub = z.infer<typeof FilialHub>;

export const VendedorHub = Base.extend({ nome: Texto(80), filial_external_id: ExternalId.optional() });
export type VendedorHub = z.infer<typeof VendedorHub>;

/** Tamanho do `codigo` da forma de pagamento no Hub (`FormaPagamentoHub.codigo`). */
export const LIMITE_CODIGO_FORMA_PAGAMENTO = 30;
export const FormaPagamentoHub = Base.extend({ codigo: Texto(LIMITE_CODIGO_FORMA_PAGAMENTO), nome: Texto(60) });
export type FormaPagamentoHub = z.infer<typeof FormaPagamentoHub>;

export const PrazoPagamentoHub = Base.extend({
  forma_external_id: ExternalId,
  codigo: Texto(20),
  /** `"28/56"`; à vista = `"0"`. */
  parcelas_dias: z.string().regex(/^\d{1,3}(\/\d{1,3})*$/),
  descricao: Texto(60).optional(),
});
export type PrazoPagamentoHub = z.infer<typeof PrazoPagamentoHub>;

/** Sem custo e sem preço de venda, por construção (M8). */
export const ProdutoHub = Base.extend({
  sku: Texto(60),
  nome: Texto(120),
  unidade: SiglaMedida,
  ean: z.string().optional(),
  marca: Texto(60).optional(),
});
export type ProdutoHub = z.infer<typeof ProdutoHub>;

export const ProdutoUnidadeHub = Base.extend({
  produto_external_id: ExternalId,
  unidade: SiglaMedida,
  fator: Quantidade.positive(),
  ean: z.string().optional(),
  padrao: z.boolean(),
});
export type ProdutoUnidadeHub = z.infer<typeof ProdutoUnidadeHub>;

export const PrecoHub = Base.extend({
  tabela_external_id: ExternalId,
  tabela_nome: Texto(120),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.optional(),
  produto_external_id: ExternalId,
  preco_cents: Centavos,
  /** Ausente = vale para todas as filiais (premissa P-1: a filial padrão do ERP sai sem filial). */
  filial_external_id: ExternalId.optional(),
});
export type PrecoHub = z.infer<typeof PrecoHub>;

export const EstoqueHub = Base.extend({
  deposito_external_id: ExternalId,
  deposito_nome: Texto(120).optional(),
  produto_external_id: ExternalId,
  saldo: Quantidade,
  filial_external_id: ExternalId,
});
export type EstoqueHub = z.infer<typeof EstoqueHub>;

export const EnderecoClienteHub = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  cep: z.string().optional(),
});

/** Minimização (M9): sem e-mail, contato, coordenadas nem observação. `vendedor_external_id` é a carteira (D7). */
export const ClienteHub = Base.extend({
  razao_social: Texto(60),
  nome_fantasia: Texto(60).optional(),
  documento: z.string().optional(),
  inscricao_estadual: z.string().optional(),
  vendedor_external_id: ExternalId.optional(),
  filial_external_id: ExternalId,
  endereco: EnderecoClienteHub.optional(),
  limite_credito_cents: Centavos,
  /** Códigos de forma do Hub da condição do cliente (premissa P-1: lista). */
  formas_pagamento: z.array(z.string()).optional(),
  prazo_medio_max_dias: z.number().int().min(0).optional(),
});
export type ClienteHub = z.infer<typeof ClienteHub>;

export const ClienteEnderecoHub = Base.extend({
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
export type ClienteEnderecoHub = z.infer<typeof ClienteEnderecoHub>;

export const PAYLOADS_HUB = {
  filial: FilialHub,
  vendedor: VendedorHub,
  forma_pagamento: FormaPagamentoHub,
  prazo_pagamento: PrazoPagamentoHub,
  produto: ProdutoHub,
  produto_unidade: ProdutoUnidadeHub,
  preco: PrecoHub,
  estoque: EstoqueHub,
  cliente: ClienteHub,
  cliente_endereco: ClienteEnderecoHub,
} as const;

/** Registro como vai em `registros` do lote: o payload canônico + `alterado_em` (UTC, ms). */
export const RegistroLote = z.object({ external_id: ExternalId, alterado_em: Instante, ativo: z.boolean() }).passthrough();
export type RegistroLote = z.infer<typeof RegistroLote>;

export const ModoLote = z.enum(['completo', 'delta']);
export type ModoLote = z.infer<typeof ModoLote>;
export const CursorHub = z.object({ alterado_em: Instante, external_id: ExternalId });
export type CursorHub = z.infer<typeof CursorHub>;
export const SessaoLote = z.object({ id: Uuid, parte: z.number().int().min(1), ultimo: z.boolean() });
export type SessaoLote = z.infer<typeof SessaoLote>;
/** Linha recusada no ERP antes do envio (M5), como o ERP a guarda: código do catálogo e campo, nunca o valor (RN-INF-04). */
export const LinhaInvalida = z.object({
  external_id: ExternalId,
  codigo: CodigoErro,
  campo: CampoErro,
});
export type LinhaInvalida = z.infer<typeof LinhaInvalida>;

/** Códigos que o Hub aceita em `linhas_invalidas` do Conector (subconjunto de `CODIGOS_ERRO_LINHA` do FDV que o ERP usa). */
export const CODIGOS_LINHA_HUB = ['campo_obrigatorio', 'formato_invalido', 'regra_invalida'] as const;

/** Como a linha inválida vai no corpo (`LinhaInvalidaConector` do FDV): `mensagem` obrigatória, do catálogo do ERP (sem valor). */
export const LinhaInvalidaHub = z.object({
  external_id: ExternalId,
  codigo: z.enum(CODIGOS_LINHA_HUB),
  campo: CampoErro.optional(),
  mensagem: z.string().min(1).max(300),
});
export type LinhaInvalidaHub = z.infer<typeof LinhaInvalidaHub>;
/** Nome do FDV (e do Conector 1.5.0) para a `LinhaInvalidaHub`. */
export const LinhaInvalidaConector = LinhaInvalidaHub;
export type LinhaInvalidaConector = LinhaInvalidaHub;

/** Corpo de `POST /integracao/v1/lotes`. */
export const CorpoLote = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  entidade: EntidadeHub,
  modo: ModoLote,
  enviado_em: Instante,
  cursor: CursorHub.nullable(),
  sessao: SessaoLote.optional(),
  registros: z.array(RegistroLote).max(LIMITE_REGISTROS_LOTE),
  linhas_invalidas: z.array(LinhaInvalidaHub).max(500),
  linhas_invalidas_omitidas: z.number().int().min(0),
}).superRefine((c, ctx) => {
  if (c.modo === 'completo' && !c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'carga completa exige sessao' });
  if (c.modo === 'delta' && c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'delta não tem sessao' });
});
export type CorpoLote = z.infer<typeof CorpoLote>;
/** Nome da ADR 0014 §2 para o `CorpoLote`. */
export const LoteEnvelope = CorpoLote;
export type LoteEnvelope = CorpoLote;

// ---------------------------------------------------------------------------------------------------------------------
// Lado da resposta: o que o Hub (e a `/entrada/v1`) devolve ao Conector 1.5.0. Campos e limites de
// `modules/integracao/contracts/{lote.ts,conector.ts}` do FDV; `entidade` usa `EntidadeHub` (as do ERP, subconjunto do `Entidade` do FDV).
// ---------------------------------------------------------------------------------------------------------------------


/** Estados que o Hub v1 expõe ao Conector (`ESTADOS_LOTE` do FDV). Nome com `Hub`: o `EstadoLote` do módulo é o estado local do envio. */
export const ESTADOS_LOTE_HUB = ['recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou'] as const;
export const EstadoLoteHub = z.enum(ESTADOS_LOTE_HUB);
export type EstadoLoteHub = z.infer<typeof EstadoLoteHub>;

/** Resposta 202 de `POST /integracao/v1/lotes` (`LoteAceito` do FDV). `recebidos` = registros + inválidas + omitidas (sempre >= 1). */
export const LoteAceito = z.object({
  lote_id: Uuid,
  status: z.literal('recebido'),
  entidade: EntidadeHub,
  modo: ModoLote,
  recebidos: z.number().int().positive(),
  /** `true` quando a `Idempotency-Key` já tinha lote: a mesma resposta de antes, sem reprocessar. */
  repetido: z.boolean().nullish(),
  /** `GET /integracao/v1/lotes/{lote_id}`. */
  consulta: z.string(),
});
export type LoteAceito = z.infer<typeof LoteAceito>;

/** Teto e padrão de `?limite_erros=` em `GET /lotes/{id}` (o Conector pede o máximo). */
export const LIMITE_ERROS_RESPOSTA_PADRAO = 1000;
export const LIMITE_ERROS_RESPOSTA_MAX = 5500;

/** Códigos de erro por linha do Hub (`CODIGOS_ERRO_LINHA` do FDV, RN-INT-03); os dois últimos são reprocessáveis. */
export const CODIGOS_ERRO_LINHA_HUB = [
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

/** Linha com erro no resultado (`LinhaErro` do FDV): sem valor de campo nem dado pessoal. */
export const LinhaErroHub = z.object({
  /** Posição da linha no lote, base 0. */
  indice: z.number().int().nonnegative(),
  external_id: z.string().max(EXTERNAL_ID_MAX).nullable(),
  codigo: z.enum(CODIGOS_ERRO_LINHA_HUB),
  campo: CampoErro,
  /** Texto fixo do catálogo (até 200), nunca o valor recebido. */
  mensagem: z.string().max(200),
  reprocessavel: z.boolean(),
  /** `conector` = veio em `linhas_invalidas`; ausente = validada no Hub. */
  origem: z.enum(['hub', 'conector']).nullish(),
});
export type LinhaErroHub = z.infer<typeof LinhaErroHub>;
/** Nome do FDV para a `LinhaErroHub`. */
export const LinhaErro = LinhaErroHub;
export type LinhaErro = LinhaErroHub;

/** Avisos por linha (`CODIGOS_AVISO_LINHA` do FDV): a linha é aplicada mesmo assim. */
export const CODIGOS_AVISO_LINHA_HUB = [
  'duplicado_no_lote',
  'cadastro_incompleto',
  'referencia_fraca_ausente',
  'aplicacao_cortada',
  'referencias_cortadas',
  'referencia_descartada',
  'oferece_junto_cortado',
  'prazo_medio_divergente',
  'marca_concorrente_desconhecida',
  'vendedor_sem_filial',
  'avisos_omitidos',
] as const;
export const AvisoLinhaHub = z.object({
  indice: z.number().int().nonnegative(),
  external_id: z.string(),
  codigo: z.enum(CODIGOS_AVISO_LINHA_HUB),
  mensagem: z.string(),
});
export type AvisoLinhaHub = z.infer<typeof AvisoLinhaHub>;

export const ContagensLote = z.object({
  recebidas: z.number().int().nonnegative(),
  duplicadas_no_lote: z.number().int().nonnegative(),
  com_erro: z.number().int().nonnegative(),
  novas: z.number().int().nonnegative(),
  atualizadas: z.number().int().nonnegative(),
  inalteradas: z.number().int().nonnegative(),
  /** Versão mais antiga que a atual: não grava nem publica. */
  obsoletas: z.number().int().nonnegative().default(0),
});
export type ContagensLote = z.infer<typeof ContagensLote>;

/** Situação da inativação no último lote da sessão completa (RN-INT-06 do FDV). */
export const InativacaoLote = z.object({
  situacao: z.enum(['aplicada', 'aguardando_confirmacao', 'nao_aplicavel']),
  motivo: z.string().nullish(),
  candidatos: z.number().int().nonnegative().nullish(),
  percentual: z.number().nonnegative().nullish(),
});
export type InativacaoLote = z.infer<typeof InativacaoLote>;

/** Resultado de `GET /integracao/v1/lotes/{id}` (`LoteResultado` do FDV, que o Conector lê como `ResultadoLote`). */
export const LoteResultado = z.object({
  lote_id: Uuid,
  entidade: EntidadeHub,
  modo: ModoLote,
  status: EstadoLoteHub,
  contagens: ContagensLote,
  erros: z.array(LinhaErroHub),
  avisos: z.array(AvisoLinhaHub),
  /** Cursor da entidade depois do lote (só avança em `concluido`/`concluido_com_erros`). */
  cursor: CursorHub.nullable(),
  invalidas_omitidas: z.number().int().nonnegative().nullish(),
  erros_total: z.number().int().nonnegative().nullish(),
  erros_omitidos: z.number().int().nonnegative().nullish(),
  inativacao: InativacaoLote.nullish(),
  inativadas: z.number().int().nonnegative().default(0),
  recebido_em: Instante,
  concluido_em: InstanteNulo,
});
export type LoteResultado = z.infer<typeof LoteResultado>;

/** `GET /integracao/v1/cursores/{entidade}`: de onde o Conector continua o delta. */
export const CursorEntidade = z.object({
  entidade: EntidadeHub,
  cursor: CursorHub.nullable(),
  atualizado_em: InstanteNulo,
});
export type CursorEntidade = z.infer<typeof CursorEntidade>;

/**
 * Corpo de `POST /integracao/v1/sinal` (`SinalConector` do FDV, conferido na L2a); fonte do `CorpoSinal` que o
 * `modules/integracao-fdv/contracts/monitor.ts` passa a reexportar (RD-1186). Sem dado pessoal. O `atualizacao` do Conector 1.5.0 é opcional no FDV e aqui é descartado.
 */
export const CorpoSinal = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  conector_id: ConectorIdHub,
  versao_conector: z.string().regex(/^\d+\.\d+\.\d+$/),
  em: Instante,
  fila: z.array(z.object({ estado: z.string(), lotes: z.number().int().min(0), linhas: z.number().int().min(0), maisAntigo: InstanteNulo })),
  entidades: z.array(
    z.object({
      entidade: EntidadeHub,
      fase: ModoLote,
      ultimo_sucesso: InstanteNulo,
      bloqueada: z.boolean(),
      lotes_na_fila: z.number().int().min(0),
    }),
  ),
  parado_por_versao: z.boolean().optional(),
});
export type CorpoSinal = z.infer<typeof CorpoSinal>;
/** Nome do FDV (e do Conector 1.5.0) para o `CorpoSinal`. */
export const SinalConector = CorpoSinal;
export type SinalConector = CorpoSinal;

/** Semver estrito `MAIOR.MENOR.PATCH` (pré-lançamento opcional), igual ao `REGEX_SEMVER` do FDV. */
export const REGEX_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export const VersaoSemver = z.string().regex(REGEX_SEMVER);

/** Pacote do Conector: onde baixar e como conferir (SHA-256 e assinatura). */
export const PacoteConector = z.object({
  versao: VersaoSemver,
  url: z.string().url().nullish(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  assinatura: z.string().min(1).nullish(),
  chave_publica_id: z.string().min(1).max(100).nullish(),
});
export type PacoteConector = z.infer<typeof PacoteConector>;

/** Política de versão do Conector por tenant: abaixo da mínima o Conector para; abaixo da recomendada só avisa. */
export const PoliticaVersaoConector = z.object({
  versao_minima: VersaoSemver,
  versao_recomendada: VersaoSemver,
  mensagem: z.string().max(300).nullish(),
  pacote: PacoteConector.nullish(),
});
export type PoliticaVersaoConector = z.infer<typeof PoliticaVersaoConector>;

/** Resposta 200 de `POST /integracao/v1/sinal` (`RespostaSinal` do FDV). `politica_versao` ausente = sem restrição. */
export const RespostaSinal = z.object({
  politica_versao: PoliticaVersaoConector.nullish(),
  conector_id: ConectorIdHub.nullish(),
  recebido_em: Instante.nullish(),
});
export type RespostaSinal = z.infer<typeof RespostaSinal>;

// ---------------------------------------------------------------------------------------------------------------------
// Pedidos que descem ao banco do cliente (ADR 0014 §13): o mesmo contrato do Hub do FDV que o Conector 1.5.0 consome em
// `GET /pedidos/pendentes` e `POST /pedidos/{uuid}/retorno`. Base: o `PedidoParaErpLido` do `integracao-fdv`, com os mesmos
// nomes, mas tipado. Não é `strict` (o FDV não é): campo novo é descartado. Opcional aceita `null`, como o Lido (`nullish`).
// A igualdade com o `integracao-fdv` fica num teste dele (fronteira: o SDK não importa de `modules/*`).
// ---------------------------------------------------------------------------------------------------------------------

/** Item do pedido. `quantidade` na unidade base; `unidade`, `fator` e `quantidade_venda` são só exibição (T-0013 §5.2). */
export const ItemPedidoParaErp = z.object({
  sequencia: z.number().int().min(1),
  produto_external_id: ExternalId,
  quantidade: Quantidade.positive(),
  preco_unitario_cents: Centavos,
  desconto_cents: Centavos.nullish(),
  total_cents: Centavos,
  unidade: z.string().max(6).nullish(),
  fator: Quantidade.positive().nullish(),
  quantidade_venda: Quantidade.positive().nullish(),
  aplicacao: z.string().max(1000).nullish(),
});
export type ItemPedidoParaErp = z.infer<typeof ItemPedidoParaErp>;

/**
 * Endereço de entrega: os campos do `EnderecoClienteHub`, aceitando `null`, mais `external_id` (preenchido = endereço do ERP;
 * nulo = os textos digitados) e `origem` (ausente vale `erp`), a regra do guia do Hub (T-0013 §5.2).
 */
export const EnderecoEntregaHub = z.object({
  external_id: ExternalId.nullish(),
  origem: z.string().max(20).nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  uf: z.string().nullish(),
  cep: z.string().nullish(),
});
export type EnderecoEntregaHub = z.infer<typeof EnderecoEntregaHub>;

/** Pedido aprovado no FDV que o ERP entrega ao Conector (`PedidoParaErp` do Hub). Sem dado pessoal além das chaves. */
export const PedidoParaErp = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  pedido_uuid: Uuid,
  tentativa: z.number().int().min(0).nullish(),
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId,
  filial: z.object({ codigo: Texto(20).nullish(), external_id: ExternalId.nullish() }).nullish(),
  criado_em: Instante,
  aprovado_em: Instante.nullish(),
  observacao: z.string().max(500).nullish(),
  /** Código da condição no ERP do cliente (texto livre do FDV); o ERP não o usa para resolver a condição (T-0013 §5.2). */
  condicao_pagamento_erp: z.string().max(60).nullish(),
  pagamento: z
    .object({
      forma_external_id: ExternalId.nullish(),
      prazo_external_id: ExternalId.nullish(),
      parcelas_dias: z.array(z.number().int().min(0)).nullish(),
      prazo_medio_dias: z.number().int().min(0).nullish(),
      percentual_ajuste: z.number().finite().nullish(),
    })
    .nullish(),
  frete: z
    .object({
      /** `CIF` ou `FOB` no FDV; outro valor chega e o `integracao-fdv` trata como sem frete. */
      modalidade: z.string().max(20).nullish(),
      transportadora_external_id: ExternalId.nullish(),
      /** Retrato da transportadora, como o FDV manda (o `integracao-fdv` guarda para a nota). */
      transportadora: z.record(z.unknown()).nullish(),
    })
    .nullish(),
  endereco_entrega: EnderecoEntregaHub.nullish(),
  desconto_total_cents: Centavos.nullish(),
  total_cents: Centavos,
  itens: z.array(ItemPedidoParaErp).min(1).max(500),
});
export type PedidoParaErp = z.infer<typeof PedidoParaErp>;

/** Resposta de `GET /entrada/v1/pedidos/pendentes`: só os pedidos (sem cancelamentos e sem paginação na v0.3.11). */
export const PedidosPendentesResposta = z.object({ pedidos: z.array(PedidoParaErp) });
export type PedidosPendentesResposta = z.infer<typeof PedidosPendentesResposta>;

/** Status aceitos pelo Hub no retorno do pedido (`StatusRetornoHub` do `integracao-fdv`). */
export const StatusRetornoHub = z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']);
export type StatusRetornoHub = z.infer<typeof StatusRetornoHub>;

/** Item de `itens_faturados` do retorno, pela `sequencia` do FDV. */
export const ItemFaturado = z.object({
  sequencia: z.number().int().min(1),
  produto_external_id: ExternalId,
  quantidade: z.number(),
  valor_cents: Centavos,
});
export type ItemFaturado = z.infer<typeof ItemFaturado>;

/** Corpo de `POST /pedidos/{uuid}/retorno` (`RetornoErp` do Hub, igual ao do `integracao-fdv`). Sem XML, sem dado pessoal. */
export const RetornoErp = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  pedido_uuid: Uuid,
  status: StatusRetornoHub,
  numero_erp: z.string().min(1).max(30).optional(),
  motivo: z.string().max(300).optional(),
  nota: z
    .object({ numero: z.number().int(), serie: z.number().int(), chave: z.string(), emitida_em: z.string(), total_cents: Centavos })
    .optional(),
  itens_faturados: z.array(ItemFaturado).optional(),
  ocorrido_em: Instante,
});
export type RetornoErp = z.infer<typeof RetornoErp>;
/** Nome do lado do Conector para o `RetornoErp`. */
export const RetornoParaHub = RetornoErp;
export type RetornoParaHub = RetornoErp;

/** Resposta de `POST /pedidos/{uuid}/retorno` aceito. */
export const RetornoAceito = z.object({ pedido_uuid: Uuid, aceito: z.literal(true) });
export type RetornoAceito = z.infer<typeof RetornoAceito>;

// ---------------------------------------------------------------------------------------------------------------------
// Só do ERP: a `/entrada/v1` (ADR 0014 §3, §13 e §14). O pré-cadastro de cliente (`ClienteParaErp`, `RetornoCliente`)
// foi para a v0.3.12 e não está neste arquivo.
// ---------------------------------------------------------------------------------------------------------------------

/** Caminhos da `/entrada/v1`, no formato de rota do Fastify (`:param`). */
export const CAMINHOS_ENTRADA_V1 = Object.freeze({
  lotes: '/entrada/v1/lotes',
  lote: '/entrada/v1/lotes/:id',
  cursor: '/entrada/v1/cursores/:entidade',
  sinal: '/entrada/v1/sinal',
  pedidosPendentes: '/entrada/v1/pedidos/pendentes',
  pedidoRetorno: '/entrada/v1/pedidos/:uuid/retorno',
  notasPendentes: '/entrada/v1/notas/pendentes',
  notaRetorno: '/entrada/v1/notas/:chave/retorno',
} as const);

/** Códigos de erro da `/entrada/v1` (lista fechada): `codigo` do corpo de erro, nunca mensagem livre. */
export const CODIGOS_ERRO_ENTRADA = [
  'entidade_fora_da_fase',
  'entidade_dono_erp',
  'conector_desconhecido',
  'credencial_invalida',
  'pepper_ausente',
  'lote_em_andamento',
  'idempotencia_conflito',
] as const;
export type CodigoErroEntrada = (typeof CODIGOS_ERRO_ENTRADA)[number];

/** Item da nota como vai para a `sp_macuxi_nota_item_inserir`: `n` é o `nItem` da NF-e (1 a 990). */
export const ItemNotaParaCliente = z.object({
  n: z.number().int().min(1),
  produto_external_id: ExternalId,
  unidade: Texto(6),
  quantidade: Quantidade.positive(),
  valor_unitario_cents: Centavos,
  valor_total_cents: Centavos,
  cfop: z.string().regex(/^\d{4}$/),
});
export type ItemNotaParaCliente = z.infer<typeof ItemNotaParaCliente>;

/**
 * Nota emitida pelo ERP que desce ao banco do cliente (`GET /entrada/v1/notas/pendentes`, faturamento ligado; ADR 0014 §13), gravada
 * pela `sp_macuxi_nota_inserir`. Contrato novo, só do ERP. Sem XML: campo fora do contrato é descartado.
 */
export const NotaParaCliente = z.object({
  chave: z.string().regex(/^\d{44}$/),
  numero: z.number().int().min(1).max(999_999_999),
  serie: z.number().int().min(0).max(999),
  emitida_em: Instante,
  pedido_uuid: Uuid.optional(),
  cliente_external_id: ExternalId,
  total_produtos_cents: Centavos,
  total_desconto_cents: Centavos,
  total_frete_cents: Centavos,
  total_ipi_cents: Centavos,
  total_icms_st_cents: Centavos,
  total_cents: Centavos,
  itens: z.array(ItemNotaParaCliente).min(1).max(990),
});
export type NotaParaCliente = z.infer<typeof NotaParaCliente>;

/** Resposta de `GET /entrada/v1/notas/pendentes`: até 100 notas por busca. */
export const NotasPendentesResposta = z.object({ notas: z.array(NotaParaCliente).max(100) });
export type NotasPendentesResposta = z.infer<typeof NotasPendentesResposta>;

/** Corpo de `POST /entrada/v1/notas/{chave}/retorno`: a gravação no banco do cliente. `codigo` do catálogo, nunca texto livre. */
export const RetornoNota = z.object({ situacao: z.enum(['gravada', 'rejeitada']), codigo: CodigoErro.optional() });
export type RetornoNota = z.infer<typeof RetornoNota>;
