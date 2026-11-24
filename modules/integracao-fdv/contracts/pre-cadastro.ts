/**
 * Pré-cadastro de cliente FDV -> ERP (T-0059; RN-INT-22).
 * Contrato do FDV: `aloirr/macuxifdv@79e5c6c`, `modules/integracao/contracts/cliente-erp.ts`.
 * `platform-sdk/hub-v1` não existe neste repositório e o `hub.ts` do módulo não exporta esses limites; ficam aqui, sem cópia em outro lugar.
 */
import { z } from 'zod';

/** `GET /integracao/v1/clientes/pendentes?limite=N`: padrão 50, máximo 100. */
export const CLIENTES_PENDENTES_LIMITE_PADRAO = 50;
export const CLIENTES_PENDENTES_LIMITE_MAXIMO = 100;
/** Comprimento máximo do `external_id` do Hub (comparado por bytes). */
export const EXTERNAL_ID_MAX = 200;
export const RETORNO_MOTIVO_MAX = 1000;
export const RETORNO_ERROS_MAX = 50;

const Uuid = z.string().uuid();
/** ISO 8601 em UTC, com `Z`. */
const Instante = z.string().datetime();
const Texto200Nulo = z.string().max(200).nullable();

/** Item do `GET /integracao/v1/clientes/pendentes`. */
export const ClienteParaErp = z.object({
  cliente_uuid: Uuid,
  recebido_em: Instante,
  razao_social: z.string().min(1).max(200),
  nome_fantasia: Texto200Nulo,
  documento: Texto200Nulo,
  inscricao_estadual: Texto200Nulo,
  telefone: Texto200Nulo,
  email: Texto200Nulo,
  logradouro: Texto200Nulo,
  numero: Texto200Nulo,
  complemento: Texto200Nulo,
  bairro: Texto200Nulo,
  cidade: Texto200Nulo,
  uf: Texto200Nulo,
  cep: Texto200Nulo,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  filial_external_id: z.string().max(EXTERNAL_ID_MAX).nullable(),
  codigo_fdv: z
    .string()
    .regex(/^\d{5,}$/)
    .nullish(),
  revisao: z.number().int().min(1).optional(),
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullish(),
  tentativa: z.number().int().min(1).optional(),
});
export type ClienteParaErp = z.infer<typeof ClienteParaErp>;

/** Saída do `GET /integracao/v1/clientes/pendentes`. */
export const ClientesPendentes = z.object({ clientes: z.array(ClienteParaErp) });
export type ClientesPendentes = z.infer<typeof ClientesPendentes>;

/** Erro por campo (`codigo` é texto opaco do cadastros, ex.: `RN-CAD-01`). */
export const ErroCampoPreCadastro = z.object({
  campo: z.string().min(1).max(60),
  codigo: z.string().min(1).max(60),
  mensagem: z.string().min(1).max(300),
});
export type ErroCampoPreCadastro = z.infer<typeof ErroCampoPreCadastro>;

const ExternalIdRetorno = z.string().trim().min(1).max(EXTERNAL_ID_MAX);
const RetornoBase = {
  versao_contrato: z.literal('v1'),
  cliente_uuid: Uuid,
  revisao: z.number().int().min(1).optional(),
  ocorrido_em: Instante,
};

/** Corpo do `POST /integracao/v1/clientes/{cliente_uuid}/retorno`: `external_id` só em vinculado; `motivo` e `erros` só em rejeitado_erp. */
export const RetornoCliente = z.discriminatedUnion('status', [
  z.object({ ...RetornoBase, status: z.literal('vinculado'), external_id: ExternalIdRetorno }),
  z.object({
    ...RetornoBase,
    status: z.literal('rejeitado_erp'),
    motivo: z.string().min(1).max(RETORNO_MOTIVO_MAX),
    erros: z.array(ErroCampoPreCadastro).min(1).max(RETORNO_ERROS_MAX).optional(),
  }),
]);
export type RetornoCliente = z.infer<typeof RetornoCliente>;

/** Resposta do retorno. */
export const RetornoClienteAceito = z.object({
  cliente_uuid: Uuid,
  estado: z.enum(['pendente', 'enviado', 'vinculado', 'rejeitado']),
  repetido: z.boolean(),
  revisao: z.number().int(),
  obsoleto: z.literal(true).optional(),
});
export type RetornoClienteAceito = z.infer<typeof RetornoClienteAceito>;
