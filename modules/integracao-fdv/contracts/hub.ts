/**
 * C-6: payloads do Hub `/integracao/v1` por entidade (docs/desenho/T-0009.md, seção 2).
 * Premissa P-1 (nomes e enums exatos ainda a conferir contra `modules/integracao/contracts/lote.ts` do FDV): seguimos o
 * desenho. Decimais (fator, saldo) vão como string sem float; dinheiro em centavos inteiros; datas-hora ISO UTC com `Z`.
 * `titulo` e `nota` são da F4 (T-0016) e ainda não têm contrato aqui.
 */
import { z } from 'zod';

/** As 12 entidades do Hub que o ERP alimenta, na ordem de carga (RN-INF-02). Igual ao domínio `entidade_hub` do banco. */
export const ENTIDADES_HUB = [
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
  'titulo',
  'nota',
] as const;
export const EntidadeHub = z.enum(ENTIDADES_HUB);
export type EntidadeHub = z.infer<typeof EntidadeHub>;
/** Entidades com contrato nesta fase (F2). */
export const ENTIDADES_HUB_F2 = ENTIDADES_HUB.slice(0, 10) as readonly EntidadeHub[];

/** Versão do contrato do Hub que o ERP fala. */
export const VERSAO_CONTRATO_HUB = 'v1' as const;

/** Código de erro (linha ou lote): identificador do catálogo, nunca mensagem livre. */
export const CodigoErro = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
export type CodigoErro = z.infer<typeof CodigoErro>;

/** Nome do campo com erro (caminho do payload); igual à restrição do banco (0007). */
export const CampoErro = z.string().regex(/^[A-Za-z0-9_.[\]]{1,80}$/).nullable();

export const SituacaoEntidade = z.enum(['ok', 'pausada']);
export type SituacaoEntidade = z.infer<typeof SituacaoEntidade>;

const Texto = (max: number) => z.string().min(1).max(max);
const ExternalId = z.string().min(1).max(200);
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Decimal = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const Centavos = z.number().int().min(0);

/** Campos de todo registro, além dos da entidade. `alterado_em` fica fora do hash (RN-INF-03). */
const Base = z.object({ external_id: ExternalId, ativo: z.boolean() });

export const FilialHub = Base.extend({
  codigo: Texto(10),
  nome: Texto(60),
  cidade: Texto(60).optional(),
  uf: z.string().regex(/^[A-Z]{2}$/).optional(),
});
export type FilialHub = z.infer<typeof FilialHub>;

export const VendedorHub = Base.extend({ nome: Texto(80), filial_external_id: ExternalId.optional() });
export type VendedorHub = z.infer<typeof VendedorHub>;

export const FormaPagamentoHub = Base.extend({ codigo: Texto(30), nome: Texto(60) });
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
  unidade: Texto(6),
  ean: z.string().optional(),
  marca: Texto(60).optional(),
});
export type ProdutoHub = z.infer<typeof ProdutoHub>;

export const ProdutoUnidadeHub = Base.extend({
  produto_external_id: ExternalId,
  unidade: Texto(6),
  fator: Decimal,
  ean: z.string().optional(),
  padrao: z.boolean(),
});
export type ProdutoUnidadeHub = z.infer<typeof ProdutoUnidadeHub>;

export const PrecoHub = Base.extend({
  tabela_external_id: ExternalId,
  tabela_nome: Texto(60),
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
  deposito_nome: Texto(60).optional(),
  produto_external_id: ExternalId,
  saldo: Decimal,
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
export const RegistroLote = z.object({ external_id: ExternalId, alterado_em: z.string().datetime(), ativo: z.boolean() }).passthrough();
export type RegistroLote = z.infer<typeof RegistroLote>;

export const ModoLote = z.enum(['completo', 'delta']);
export type ModoLote = z.infer<typeof ModoLote>;
export const CursorHub = z.object({ alterado_em: z.string().datetime(), external_id: ExternalId });
export type CursorHub = z.infer<typeof CursorHub>;
export const SessaoLote = z.object({ id: z.string().uuid(), parte: z.number().int().min(1), ultimo: z.boolean() });
export type SessaoLote = z.infer<typeof SessaoLote>;
/** Linha recusada no ERP antes do envio (M5): código e campo, nunca o valor (RN-INF-04). */
export const LinhaInvalida = z.object({
  external_id: ExternalId,
  codigo: CodigoErro,
  campo: CampoErro,
});
export type LinhaInvalida = z.infer<typeof LinhaInvalida>;

/** Corpo de `POST /integracao/v1/lotes`. */
export const CorpoLote = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  entidade: EntidadeHub,
  modo: ModoLote,
  enviado_em: z.string().datetime(),
  cursor: CursorHub.nullable(),
  sessao: SessaoLote.optional(),
  registros: z.array(RegistroLote).max(5000),
  linhas_invalidas: z.array(LinhaInvalida).max(500),
  linhas_invalidas_omitidas: z.number().int().min(0),
}).superRefine((c, ctx) => {
  if (c.modo === 'completo' && !c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'carga completa exige sessao' });
  if (c.modo === 'delta' && c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'delta não tem sessao' });
});
export type CorpoLote = z.infer<typeof CorpoLote>;
