/**
 * Contratos públicos do módulo integracao-fdv (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { z } from 'zod';
import { EXTERNAL_ID_MAX } from '@macuxierp/platform-sdk/hub-v1';
import type { EntidadeHub } from './hub';

export const MODULO = 'integracao-fdv' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

export * from './credencial';
export * from './eventos';
export * from './hub';
export * from './monitor';

/**
 * Cópia local, tolerante, do `PedidoParaErp` do Hub do FDV (T-0013 §5.2; nomes a conferir na T-0011/T-0017, P-1).
 * `passthrough`: campo novo do Hub não derruba o pedido. Item fora do contrato = `rejeitado` com `pedido_fora_do_contrato`.
 */
const UuidLido = z.string().uuid();
/** Chave do Hub (`external_id`, 1 a `EXTERNAL_ID_MAX` caracteres, comparada por bytes): a do kit (ex.: `C000123`) ou o UUID do ERP (ADR 0010). */
const ChaveHubLida = z.string().min(1).max(EXTERNAL_ID_MAX);
const DecimalLido = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
const CentavosLido = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ItemPedidoParaErpLido = z
  .object({
    sequencia: z.number().int().min(1),
    produto_external_id: ChaveHubLida,
    quantidade: DecimalLido,
    unidade: z.string().max(6).nullish(),
    fator: DecimalLido.nullish(),
    quantidade_venda: DecimalLido.nullish(),
    preco_unitario_cents: CentavosLido,
    desconto_cents: CentavosLido.nullish(),
    total_cents: CentavosLido,
    aplicacao: z.string().max(1000).nullish(),
  })
  .passthrough();
export const PedidoParaErpLido = z
  .object({
    pedido_uuid: UuidLido,
    cliente_external_id: ChaveHubLida,
    vendedor_external_id: ChaveHubLida,
    filial: z.object({ external_id: ChaveHubLida.nullish() }).passthrough().nullish(),
    pagamento: z
      .object({ prazo_external_id: ChaveHubLida.nullish() })
      .passthrough()
      .nullish(),
    criado_em: z.string().datetime({ offset: true }),
    aprovado_em: z.string().datetime({ offset: true }).nullish(),
    observacao: z.string().max(500).nullish(),
    frete: z.record(z.unknown()).nullish(),
    endereco_entrega: z.record(z.unknown()).nullish(),
    itens: z.array(ItemPedidoParaErpLido).min(1).max(500),
    total_cents: CentavosLido,
    versao_contrato: z.string().max(20).nullish(),
    tentativa: z.number().int().nullish(),
  })
  .passthrough();
export type PedidoParaErpLido = z.infer<typeof PedidoParaErpLido>;

/** Entidades do Hub cujas chaves o ERP resolve para UUID pela porta `ResolvedorChaveErp` (ADR 0010, item 2). */
export type EntidadeChaveErp = Extract<EntidadeHub, 'cliente' | 'vendedor' | 'filial' | 'produto' | 'prazo_pagamento' | 'cliente_endereco'>;

/** Status aceitos pelo Hub no retorno do pedido (doc 06; `retorno_enviado.status`). */
export const StatusRetornoHub = z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']);
export type StatusRetornoHub = z.infer<typeof StatusRetornoHub>;

/** Corpo do `POST /integracao/v1/pedidos/{uuid}/retorno` (`RetornoErp` do Hub; T-0013 §6.2). Sem XML, sem dado pessoal. */
export const RetornoErp = z.object({
  versao_contrato: z.literal('v1'),
  pedido_uuid: UuidLido,
  status: StatusRetornoHub,
  numero_erp: z.string().min(1).max(30).optional(),
  motivo: z.string().max(300).optional(),
  nota: z
    .object({
      /** `NotaRetorno` do Hub (OpenAPI real, 24/11): `numero` é TEXTO (1 a 40) e `serie` texto (até 10) ou nulo; inteiro dá 400 `requisicao_invalida` (D3). */
      numero: z.string().min(1).max(40),
      serie: z.string().max(10).nullable(),
      /** O `NotaRetorno` do Hub ainda não tem a chave de acesso: o ERP a manda assim mesmo (pedido ao FDV, D3); o Hub a ignora até ter o campo. */
      chave: z.string(),
      emitida_em: z.string(),
      total_cents: CentavosLido,
    })
    .optional(),
  itens_faturados: z
    .array(z.object({ sequencia: z.number().int().min(1), produto_external_id: ChaveHubLida, quantidade: z.number(), valor_cents: CentavosLido }))
    .optional(),
  ocorrido_em: z.string().datetime(),
});
export type RetornoErp = z.infer<typeof RetornoErp>;
