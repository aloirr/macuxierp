/**
 * C-6: payloads do Hub `/integracao/v1` por entidade (docs/desenho/T-0009.md, seção 2).
 * Conferido contra o `modules/integracao/contracts` do FDV (P-1, L2a): quantidades (fator, saldo) são número; dinheiro em
 * centavos inteiros; datas-hora ISO UTC com `Z`; `linhas_invalidas` leva `mensagem` e código do conjunto do Hub.
 * `titulo` e `nota` são da F4 (T-0016) e ainda não têm contrato aqui.
 */
import { z } from 'zod';
import { CampoErroFdv, CodigoErroFdv, ENTIDADES_ENVIO_FDV, LIMITE_REGISTROS_LOTE_FDV } from '@macuxierp/platform-sdk';
import { ExternalId, LIMITE_CODIGO_FORMA_PAGAMENTO } from '@macuxierp/platform-sdk/hub-v1';

/** As 12 entidades do Hub que o ERP alimenta, na ordem de carga (RN-INF-02): as 10 da F2 vêm do SDK (ADR 0013), título e nota são da F4. */
export const ENTIDADES_HUB = [...ENTIDADES_ENVIO_FDV, 'titulo', 'nota'] as const;
export const EntidadeHub = z.enum(ENTIDADES_HUB);
export type EntidadeHub = z.infer<typeof EntidadeHub>;
/** Entidades com contrato nesta fase (F2). */
export const ENTIDADES_HUB_F2 = ENTIDADES_HUB.slice(0, 10) as readonly EntidadeHub[];

/** Registros por lote do Hub (limite do contrato, doc 06): `CorpoLote`, a credencial (`ConfiguracaoEntrada`) e o `domain/lote` usam só esta constante. */
export const LIMITE_REGISTROS_LOTE = LIMITE_REGISTROS_LOTE_FDV;

/** Versão do contrato do Hub que o ERP fala. */
export const VERSAO_CONTRATO_HUB = 'v1' as const;
/** Versão que só a entidade `prazo_pagamento` tem (ADR 0072 do FDV, ainda não publicada): a v1 segue aceita por 6 meses. */
export const VERSAO_CONTRATO_PRAZO_V2 = 'v2' as const;
/**
 * Opção do envio do prazo no contrato v2 (T-0085, lote 2; T-0105). LIGADA: a v2 está no ar no FDV desde a v1.0.34 (a v1 segue
 * aceita por 6 meses). Constante do módulo, não por tenant: a v2 vale para o Hub inteiro. O hash do lote leva a versão, então o
 * primeiro envio depois da virada reenvia os prazos uma vez (idempotente por `external_id`).
 */
export const PRAZO_CONTRATO_V2_LIGADO = true;

/**
 * Código de erro (linha ou lote) e campo com erro: a fonte é o SDK (T-0086, `portal-integracao-operacao.ts`); `CodigoErro` e
 * `CampoErro` são o mesmo Zod com o nome do módulo. O campo bate com a restrição do banco (0007).
 */
export const CodigoErro = CodigoErroFdv;
export type CodigoErro = z.infer<typeof CodigoErroFdv>;
export const CampoErro = CampoErroFdv;

export const SituacaoEntidade = z.enum(['ok', 'pausada']);
export type SituacaoEntidade = z.infer<typeof SituacaoEntidade>;

/** A-04 (RN-CORE-19 do FDV): sigla de medida = 1 a 4 letras maiúsculas (`SIGLA_MEDIDA_FORMATO`); o Hub ainda confere se ela existe nas medidas do tenant. */
const SiglaMedida = z.string().regex(/^[A-Z]{1,4}$/);
const Texto = (max: number) => z.string().min(1).max(max);
/** Limites do prazo no Hub (v1 e v2): até `MAX_PARCELAS_HUB` parcelas e `MAX_DIAS_HUB` dias, tanto nas parcelas quanto no prazo médio. */
const MAX_DIAS_HUB = 365;
const MAX_PARCELAS_HUB = 24;
const PrazoMedioDiasHub = z.number().int().min(0).max(MAX_DIAS_HUB);
const ParcelasDiasHub = z.array(z.number().int().min(0).max(MAX_DIAS_HUB)).min(1).max(MAX_PARCELAS_HUB);
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Quantidade do Hub (`Quantidade` do `base.ts` do FDV): número finito, pode ser fracionário (P-1: não é texto). */
const Quantidade = z.number().finite();
const Centavos = z.number().int().min(0);

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

export const FormaPagamentoHub = Base.extend({ codigo: Texto(LIMITE_CODIGO_FORMA_PAGAMENTO), nome: Texto(60) });
export type FormaPagamentoHub = z.infer<typeof FormaPagamentoHub>;

export const PrazoPagamentoHub = Base.extend({
  forma_external_id: ExternalId,
  codigo: Texto(20),
  /** Lista de inteiros, ex.: `[28, 56]`; à vista = `[0]` (T-0085). */
  parcelas_dias: ParcelasDiasHub,
  /** T-0085 lote 2: o prazo só sai completo (RN-CAD-15): descrição e prazo médio são obrigatórios. */
  descricao: Texto(60),
  prazo_medio_dias: PrazoMedioDiasHub,
});
export type PrazoPagamentoHub = z.infer<typeof PrazoPagamentoHub>;

/**
 * Prazo no contrato v2 do Hub (ADR 0072 do FDV): obrigatórios `external_id`, `alterado_em`, `codigo` (1 a 20), `forma_external_id`,
 * `descricao` (1 a 60), `parcelas_dias` (1 a `MAX_PARCELAS_HUB` inteiros de 0 a `MAX_DIAS_HUB`, sem decrescer; à vista `[0]`) e `prazo_medio_dias` (0 a `MAX_DIAS_HUB`,
 * entre a menor e a maior parcela); opcionais `ativo`, `ordem` e `percentual_ajuste`. `alterado_em` entra na montagem do lote.
 */
export const PrazoPagamentoHubV2 = z
  .object({
    external_id: ExternalId,
    alterado_em: z.string().datetime(),
    codigo: Texto(20),
    forma_external_id: ExternalId,
    descricao: Texto(60),
    parcelas_dias: ParcelasDiasHub,
    prazo_medio_dias: PrazoMedioDiasHub,
    ativo: z.boolean().optional(),
    ordem: z.number().int().min(0).optional(),
    percentual_ajuste: z.number().finite().optional(),
  })
  .superRefine((p, ctx) => {
    const l = p.parcelas_dias;
    if (l.some((d, i) => i > 0 && d < l[i - 1]!)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['parcelas_dias'], message: 'parcelas não podem decrescer' });
    if (l.length > 0 && (p.prazo_medio_dias < Math.min(...l) || p.prazo_medio_dias > Math.max(...l))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prazo_medio_dias'], message: 'prazo médio fora do intervalo das parcelas' });
    }
  });
export type PrazoPagamentoHubV2 = z.infer<typeof PrazoPagamentoHubV2>;

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
  /** RN-CAD-16: prazo médio máximo do cliente; ausente = sem limite. `formas_pagamento` deixou de sair (T-0085 lote 2). */
  prazo_medio_max_dias: PrazoMedioDiasHub.optional(),
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

/** Corpo de `POST /integracao/v1/lotes`. */
export const CorpoLote = z.object({
  versao_contrato: z.enum([VERSAO_CONTRATO_HUB, VERSAO_CONTRATO_PRAZO_V2]),
  entidade: EntidadeHub,
  modo: ModoLote,
  enviado_em: z.string().datetime(),
  cursor: CursorHub.nullable(),
  sessao: SessaoLote.optional(),
  registros: z.array(RegistroLote).max(LIMITE_REGISTROS_LOTE),
  linhas_invalidas: z.array(LinhaInvalidaHub).max(500),
  linhas_invalidas_omitidas: z.number().int().min(0),
}).superRefine((c, ctx) => {
  if (c.versao_contrato === VERSAO_CONTRATO_PRAZO_V2 && c.entidade !== 'prazo_pagamento') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['versao_contrato'], message: 'v2 só existe para prazo_pagamento' });
  if (c.modo === 'completo' && !c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'carga completa exige sessao' });
  if (c.modo === 'delta' && c.sessao) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessao'], message: 'delta não tem sessao' });
});
export type CorpoLote = z.infer<typeof CorpoLote>;
