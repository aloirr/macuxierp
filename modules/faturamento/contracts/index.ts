/**
 * Contratos públicos do módulo faturamento (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { z } from 'zod';

export const MODULO = 'faturamento' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

/** Tipos de campo vindos de cadastros (o faturamento já depende dele). */
export { Centavos, Qtd4, Uuid } from '@macuxierp/cadastros/contracts';
import { Centavos, Qtd4, Uuid } from '@macuxierp/cadastros/contracts';

export const Ambiente = z.enum(['homologacao', 'producao']);
export type Ambiente = z.infer<typeof Ambiente>;

/** Máquina de estados da nota (RN-FAT-02, RN-FAT-03, RN-FAT-07). Espelha o CHECK de `faturamento.nota.status`. */
export const StatusNota = z.enum([
  'rascunho',
  'em_autorizacao',
  'autorizada_guarda_pendente',
  'autorizada',
  'rejeitada',
  'denegada',
  'cancelada',
  'emitida_contingencia',
  'inutilizada',
]);
export type StatusNota = z.infer<typeof StatusNota>;

/** tpEmis: 1 normal, 6 SVC-AN, 7 SVC-RS (RN-FAT-05; a modalidade fica em ADR). */
export const TipoEmissao = z.union([z.literal(1), z.literal(6), z.literal(7)]);
export type TipoEmissao = z.infer<typeof TipoEmissao>;

/**
 * Chave de acesso de 44 posições. CNPJ alfanumérico (NT 2025.001, válido desde jul/2026): as 12 primeiras posições do CNPJ
 * aceitam A-Z e 0-9; os 2 DV do CNPJ e todo o resto seguem numéricos. Única fonte do regex (domain e api importam daqui).
 */
export const CHAVE_ACESSO_REGEX = /^\d{6}[A-Z0-9]{12}\d{26}$/;
export const ChaveAcesso = z.string().regex(CHAVE_ACESSO_REGEX);
export type ChaveAcesso = z.infer<typeof ChaveAcesso>;

/** Número de protocolo de autorização (nProt). */
export const Protocolo = z.string().min(1).max(20);

/** Identificação da nota nos eventos. `chave_acesso` e `protocolo` são nulos na rejeição antes da autorização. */
export const NotaEvento = z.object({
  id: Uuid,
  filial_id: Uuid,
  cliente_id: Uuid,
  serie: z.number().int().min(0).max(999),
  numero: z.number().int().min(1).max(999_999_999),
  chave_acesso: ChaveAcesso.nullable(),
  emitida_em: z.string().datetime(),
  total_centavos: Centavos,
  protocolo: Protocolo.nullable(),
});
export type NotaEvento = z.infer<typeof NotaEvento>;

export const ItemNotaEvento = z.object({ sequencia: z.number().int().min(1), quantidade: Qtd4, valor_centavos: Centavos });
export type ItemNotaEvento = z.infer<typeof ItemNotaEvento>;

/**
 * Base dos eventos de nota (agregado = `nota.id`). Campos que o pedido (T-0013 §8.1) e a integração-fdv (T-0009 C-5)
 * leem com leitor tolerante. Só `ambiente = producao` vira faturamento real no FDV (RN-FAT-04, M7).
 */
const BaseEventoNota = z.object({
  pedido_id: Uuid,
  ambiente: Ambiente,
  nota: NotaEvento,
  itens: z.array(ItemNotaEvento).min(1),
  vendedor_id: Uuid.nullable(),
  quantidade_itens: z.number().int().min(1),
});

/** Identificação da nota já autorizada: chave e protocolo sempre presentes. */
export const NotaEventoAutorizada = NotaEvento.extend({ chave_acesso: ChaveAcesso, protocolo: Protocolo });
export type NotaEventoAutorizada = z.infer<typeof NotaEventoAutorizada>;

/** `faturamento.nota.autorizada@1`: publicado só depois do XML autorizado guardado (RN-FAT-03). */
export const NotaAutorizadaPayload = BaseEventoNota.extend({
  nota: NotaEventoAutorizada,
  /** UUID do pedido no FDV (T-0009 2.10); nulo para pedido nascido no ERP. */
  pedido_uuid: Uuid.nullable(),
});
export type NotaAutorizadaPayload = z.infer<typeof NotaAutorizadaPayload>;

/** `faturamento.nota.cancelada@1`: o pedido devolve as quantidades (T-0013 §2, P-2). */
export const NotaCanceladaPayload = BaseEventoNota.extend({
  nota: NotaEventoAutorizada,
  pedido_uuid: Uuid.nullable(),
  protocolo_cancelamento: Protocolo,
  motivo: z.string().min(15).max(255),
});
export type NotaCanceladaPayload = z.infer<typeof NotaCanceladaPayload>;

/** `faturamento.nota.rejeitada@1` (RF-FAT-08): código, mensagem e ação sugerida da SEFAZ. */
export const NotaRejeitadaPayload = BaseEventoNota.extend({
  codigo: z.string().regex(/^\d{3}$/),
  mensagem: z.string().max(1000),
  acao_sugerida: z.string().max(500),
});
export type NotaRejeitadaPayload = z.infer<typeof NotaRejeitadaPayload>;

/** `faturamento.titulo.gerado@1` (T-0009 §2.9): um evento por parcela. Datas civis (AAAA-MM-DD). */
export const TituloGeradoPayload = z.object({
  titulo_id: Uuid,
  nota_id: Uuid,
  pedido_id: Uuid,
  cliente_id: Uuid,
  ambiente: Ambiente,
  numero: z.number().int().min(1),
  serie: z.number().int().min(0).max(999),
  parcela: z.number().int().min(1),
  total_parcelas: z.number().int().min(1),
  emissao: z.string().date(),
  vencimento: z.string().date(),
  valor_centavos: Centavos,
  saldo_centavos: Centavos,
});
export type TituloGeradoPayload = z.infer<typeof TituloGeradoPayload>;

/** `faturamento.titulo.baixado@1` (C-5 da T-0009). */
export const TituloBaixadoPayload = TituloGeradoPayload.extend({ baixado_em: z.string().date(), valor_baixado_centavos: Centavos });
export type TituloBaixadoPayload = z.infer<typeof TituloBaixadoPayload>;

/** Entrada de `POST /v1/faturamento/notas` (RF-FAT-01). Sem `itens` = nota total do saldo do pedido. */
export const ItemEmissao = z.object({ sequencia: z.number().int().min(1), quantidade: Qtd4.positive().optional() });
export type ItemEmissao = z.infer<typeof ItemEmissao>;

export const EmitirNotaEntrada = z.object({
  pedido_id: Uuid,
  /** Parcial: só as sequências listadas, com `quantidade` (escala 4) opcional (omitida = todo o saldo do item). */
  itens: z
    .array(ItemEmissao)
    .min(1)
    .max(500)
    .optional(),
  /** Mesma `Idempotency-Key` da rota (RN-CORE-05): repetir não gera segunda nota nem queima número. */
  idempotencia: z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/),
});
export type EmitirNotaEntrada = z.infer<typeof EmitirNotaEntrada>;
