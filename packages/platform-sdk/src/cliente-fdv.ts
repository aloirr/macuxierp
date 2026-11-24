/**
 * Pré-cadastro de cliente FDV → ERP (T-0059, desenho `docs/desenho/T-0059.md`; RN-INT-22 e hub-api §6.6b do FDV).
 *
 * - `GET /integracao/v1/clientes/pendentes?limite=`: o Hub entrega os pré-cadastros sem código e os marca `enviado`
 *   (sem cursor: repete até vir vazio; `enviado` sem retorno por 10 min volta com `tentativa + 1`).
 * - `POST /integracao/v1/clientes/{cliente_uuid}/retorno`: `vinculado` (com o `external_id`) ou `rejeitado_erp` (com o motivo).
 *
 * Por que no SDK: o `integracao-fdv` (Hub e rota do BKO), o `cadastros` (porta que valida e cria o cliente e devolve os
 * erros por campo) e a apps/web (seção "Clientes recebidos do FDV") usam os mesmos Zod; o SDK não importa módulo.
 *
 * Contrato de produção: FDV v1.0.32 (tag), com a ADR 0069 do FDV desde a v1.0.30: reenvio na mesma linha com `revisao`
 * e `hash` novos, `erros` por campo na recusa e `codigo_fdv`. O ERP manda sempre a `revisao` que recebeu. Os campos da
 * ADR 0069 seguem opcionais na LEITURA (tolerância a pendente antigo, sem `revisao` = revisão 1). Regra 3: tipos só de Zod.
 */
import { z } from 'zod';
import { cnpjRaiz, normalizarDocumento } from './documentos';
import { ConsultaPaginada, paginaDe } from './listas';
import { CodigoErroFdv } from './portal-integracao-operacao';

const Uuid = z.string().uuid();
/** Data e hora com fuso, como o Hub manda (`-04:00` ou `Z`). */
const InstanteComFuso = z.string().datetime({ offset: true });
const TextoLido = z.string().max(200).nullish();

/** Limites do `?limite=` (padrão 50, máximo 100; o `pedidosPorConsulta` do tenant no FDV também corta). */
export const LIMITE_CLIENTES_PENDENTES_FDV = Object.freeze({ padrao: 50, max: 100 });

/**
 * Cópia tolerante do `ClienteParaErp` do Hub (`passthrough`: campo novo não derruba a leitura). Os campos da ADR 0069
 * (`codigo_fdv`, `revisao`, `hash`, `tentativa`) são opcionais na leitura: o `hash` é nulo nos pré-cadastros de antes da
 * v1.0.30 do FDV. Sem revisão = revisão 1.
 */
export const ClienteParaErpFdv = z
  .object({
    cliente_uuid: Uuid,
    recebido_em: InstanteComFuso,
    razao_social: z.string().min(1).max(200),
    nome_fantasia: TextoLido,
    documento: TextoLido,
    inscricao_estadual: TextoLido,
    telefone: TextoLido,
    email: TextoLido,
    logradouro: TextoLido,
    numero: TextoLido,
    complemento: TextoLido,
    bairro: TextoLido,
    cidade: TextoLido,
    uf: TextoLido,
    cep: TextoLido,
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    filial_external_id: TextoLido,
    codigo_fdv: z.string().regex(/^\d{5,}$/).nullish(),
    revisao: z.number().int().positive().optional(),
    hash: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
    tentativa: z.number().int().positive().optional(),
  })
  .passthrough();
export type ClienteParaErpFdv = z.infer<typeof ClienteParaErpFdv>;

/** Resposta do `GET /clientes/pendentes`. */
export const ClientesPendentesFdv = z.object({ clientes: z.array(ClienteParaErpFdv).max(LIMITE_CLIENTES_PENDENTES_FDV.max) }).passthrough();
export type ClientesPendentesFdv = z.infer<typeof ClientesPendentesFdv>;

/** Revisão efetiva do pré-cadastro: a do Hub ou 1 (pendente sem revisão). */
export const revisaoDoPreCadastro = (c: Pick<ClienteParaErpFdv, 'revisao'>): number => c.revisao ?? 1;

/** Limites do erro por campo (os do FDV: `ERROS_RECUSA_MAX` e `ERRO_CAMPO_LIMITES` do core do FDV). */
export const ERROS_RECUSA_CLIENTE_MAX_FDV = 50;
export const LIMITES_ERRO_CAMPO_CLIENTE_FDV = Object.freeze({ campo: 60, codigo: 60, mensagem: 300 });
const L = LIMITES_ERRO_CAMPO_CLIENTE_FDV;

/**
 * Erro por campo da recusa (RN de cliente do `cadastros`): `campo` é o nome canônico do `ClienteParaErpFdv`
 * (`documento`, `inscricao_estadual`, `cidade`...), `codigo` o código da regra e `mensagem` o texto do catálogo, sem o
 * valor recusado (LGPD).
 */
export const ErroCampoClienteFdv = z.object({
  campo: z.string().trim().min(1).max(L.campo),
  codigo: CodigoErroFdv,
  mensagem: z.string().trim().min(1).max(L.mensagem),
});
export type ErroCampoClienteFdv = z.infer<typeof ErroCampoClienteFdv>;

/** Teto do `motivo` que o ERP manda (o Hub aceita até 1000). */
export const MAX_MOTIVO_RETORNO_CLIENTE_FDV = 300;

/** Corpo do `POST /clientes/{cliente_uuid}/retorno`. `vinculado` exige `external_id`; `rejeitado_erp` exige `motivo`. */
export const RetornoClienteFdv = z
  .object({
    versao_contrato: z.literal('v1'),
    cliente_uuid: Uuid,
    status: z.enum(['vinculado', 'rejeitado_erp']),
    external_id: z.string().min(1).max(200).optional(),
    motivo: z.string().trim().min(1).max(MAX_MOTIVO_RETORNO_CLIENTE_FDV).optional(),
    revisao: z.number().int().positive().optional(),
    erros: z.array(ErroCampoClienteFdv).min(1).max(ERROS_RECUSA_CLIENTE_MAX_FDV).optional(),
    ocorrido_em: z.string().datetime(),
  })
  .superRefine((r, ctx) => {
    const erro = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (r.status === 'vinculado' && !r.external_id) erro('external_id', 'vinculado exige o código do cliente no ERP');
    if (r.status === 'vinculado' && (r.motivo !== undefined || r.erros !== undefined)) erro('motivo', 'vinculado não leva motivo nem erros');
    if (r.status === 'rejeitado_erp' && !r.motivo) erro('motivo', 'rejeitado_erp exige o motivo');
    if (r.status === 'rejeitado_erp' && r.external_id !== undefined) erro('external_id', 'rejeitado_erp não leva código');
  });
export type RetornoClienteFdv = z.infer<typeof RetornoClienteFdv>;

/** Decisão do ERP sobre uma revisão do pré-cadastro (sai do `cadastros`; o `integracao-fdv` monta o corpo). */
export type DecisaoPreCadastroFdv =
  | { status: 'vinculado'; external_id: string }
  | { status: 'rejeitado_erp'; motivo: string; erros: readonly ErroCampoClienteFdv[] };

/**
 * Corpo do retorno (pura): leva a `revisao` que o pendente trouxe e, na recusa, os `erros` por campo quando há algum. O mesmo pré-cadastro com a mesma decisão gera o mesmo corpo
 * (o hash do corpo, sem `ocorrido_em`, é a chave de idempotência do retorno no ERP).
 */
export function montarRetornoClienteFdv(
  pendente: Pick<ClienteParaErpFdv, 'cliente_uuid' | 'revisao'>,
  decisao: DecisaoPreCadastroFdv,
  opcoes: { ocorrido_em: string },
): RetornoClienteFdv {
  const base = { versao_contrato: 'v1' as const, cliente_uuid: pendente.cliente_uuid, ocorrido_em: opcoes.ocorrido_em };
  const revisao = pendente.revisao !== undefined ? { revisao: pendente.revisao } : {};
  if (decisao.status === 'vinculado') return RetornoClienteFdv.parse({ ...base, ...revisao, status: 'vinculado', external_id: decisao.external_id });
  const erros = decisao.erros.length > 0 ? { erros: decisao.erros.slice(0, ERROS_RECUSA_CLIENTE_MAX_FDV) } : {};
  return RetornoClienteFdv.parse({ ...base, ...revisao, ...erros, status: 'rejeitado_erp', motivo: decisao.motivo.slice(0, MAX_MOTIVO_RETORNO_CLIENTE_FDV) });
}

/** `200` do retorno (tolerante): `revisao` atual da linha; `obsoleto` só em recusa de revisão anterior. */
export const RetornoClienteAceitoFdv = z
  .object({
    cliente_uuid: Uuid,
    estado: z.enum(['pendente', 'enviado', 'vinculado', 'rejeitado']),
    repetido: z.boolean(),
    revisao: z.number().int().positive().optional(),
    obsoleto: z.literal(true).optional(),
  })
  .passthrough();
export type RetornoClienteAceitoFdv = z.infer<typeof RetornoClienteAceitoFdv>;

/** Códigos do `422` do retorno (`RecusaRetornoCliente` do Hub). O tratamento de cada um está no desenho T-0059 §5.3. */
export const CODIGOS_RECUSA_RETORNO_CLIENTE_FDV = [
  'cliente_desconhecido',
  'cliente_nao_entregue',
  'transicao_invalida',
  'external_id_divergente',
  'revisao_desconhecida',
] as const;
export const CodigoRecusaRetornoClienteFdv = z.enum(CODIGOS_RECUSA_RETORNO_CLIENTE_FDV);
export type CodigoRecusaRetornoClienteFdv = z.infer<typeof CodigoRecusaRetornoClienteFdv>;

// ---- BKO: "Clientes recebidos do FDV" ----

/**
 * Situação da última revisão de um pré-cadastro: `recebido` (na validação), `aceito` (virou cliente no ERP),
 * `recusado` (o motivo voltou ao FDV) e `reenviado` (revisão nova depois de uma recusa, ainda na validação).
 */
export const SITUACOES_CLIENTE_RECEBIDO_FDV = ['recebido', 'aceito', 'recusado', 'reenviado'] as const;
export const SituacaoClienteRecebidoFdv = z.enum(SITUACOES_CLIENTE_RECEBIDO_FDV);
export type SituacaoClienteRecebidoFdv = z.infer<typeof SituacaoClienteRecebidoFdv>;

/** Retorno ao FDV da última decisão: na fila, aceito pelo Hub ou parado (falha terminal; vai ao monitor). */
/** Mesmo conjunto do CHECK de `estado` do `retorno_enviado` (0007) e do `cliente_retorno` (T-0059 §3.2). */
export const SITUACOES_RETORNO_CLIENTE_FDV = ['pendente', 'enviado', 'falhou'] as const;

/**
 * Documento mascarado para a tela (LGPD; a API mascara, o documento inteiro nunca sai na rota): CPF `***.456.789-**` e
 * CNPJ `12.345.678/****-**` (raiz visível). Outro tamanho ou vazio: `null`.
 */
export function mascararDocumentoFdv(documento: string | null | undefined): string | null {
  const d = normalizarDocumento(documento ?? '');
  if (/^\d{11}$/.test(d)) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (/^[0-9A-Z]{14}$/.test(d)) {
    const r = cnpjRaiz(d);
    return `${r.slice(0, 2)}.${r.slice(2, 5)}.${r.slice(5, 8)}/****-**`;
  }
  return null;
}
export const DocumentoMascaradoFdv = z.string().regex(/^(\*\*\*\.\d{3}\.\d{3}-\*\*|[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/\*{4}-\*\*)$/);

/**
 * Uma linha da seção (`GET /v1/integracao-fdv/clientes-recebidos`, ação `integracao-fdv.ver`). Sem e-mail, telefone,
 * endereço nem coordenadas; o documento só mascarado. `vendedor_external_id` fica nulo até o FDV mandar o vendedor no
 * pendente (pedido aditivo ao FDV, desenho §8). `erros` são os da última recusa.
 */
export const ClienteRecebidoFdv = z
  .object({
    id: Uuid,
    cliente_uuid: Uuid,
    codigo_fdv: z.string().nullable(),
    razao_social: z.string().min(1).max(200),
    documento_mascarado: DocumentoMascaradoFdv.nullable(),
    vendedor_external_id: z.string().max(200).nullable(),
    recebido_em: InstanteComFuso,
    revisao: z.number().int().positive(),
    situacao: SituacaoClienteRecebidoFdv,
    motivo: z.string().max(MAX_MOTIVO_RETORNO_CLIENTE_FDV).nullable(),
    erros: z.array(ErroCampoClienteFdv).max(ERROS_RECUSA_CLIENTE_MAX_FDV),
    cliente_id: Uuid.nullable(),
    retorno: z.enum(SITUACOES_RETORNO_CLIENTE_FDV).nullable(),
  })
  .superRefine((c, ctx) => {
    if ((c.situacao === 'aceito') !== (c.cliente_id !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cliente_id'], message: 'cliente_id só e sempre no aceito' });
    }
    if ((c.situacao === 'recusado') !== (c.motivo !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo'], message: 'motivo só e sempre no recusado' });
    }
    if (c.situacao !== 'recusado' && c.erros.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['erros'], message: 'erros só no recusado' });
  });
export type ClienteRecebidoFdv = z.infer<typeof ClienteRecebidoFdv>;

/** Filtro e página da seção: a paginação única das listas (`limite` + `cursor`, `listas.ts`), mais a situação. */
export const ConsultaClientesRecebidosFdv = ConsultaPaginada.extend({ situacao: SituacaoClienteRecebidoFdv.optional() });
export const PaginaClientesRecebidosFdv = paginaDe(ClienteRecebidoFdv);
export type PaginaClientesRecebidosFdv = z.infer<typeof PaginaClientesRecebidosFdv>;
