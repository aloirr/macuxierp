/**
 * Leitor tolerante local da `faturamento.nota.autorizada@1` (T-0013 §8.1): só os campos que o pedido usa, `.passthrough()`
 * para aceitar campo novo do faturamento sem quebrar. Não importa o pacote do faturamento.
 */
import { z } from 'zod';

/** Item da nota: o pedido só usa sequência, quantidade e valor. */
export const ItemNotaLido = z.object({ sequencia: z.number().int().min(1), quantidade: z.number().int(), valor_centavos: z.number().int() }).passthrough();

export const NotaAutorizadaLida = z.object({
  /** Nota sem pedido (avulsa) não é do pedido: o consumidor a ignora. */
  pedido_id: z.string().uuid().nullish(),
  ambiente: z.enum(['homologacao', 'producao']),
  conta_como_real: z.boolean().optional(),
  nota: z.object({
    id: z.string().uuid(),
    numero: z.number().int(),
    serie: z.number().int(),
    chave_acesso: z.string(),
    emitida_em: z.string().datetime(),
    total_centavos: z.number().int(),
  }).passthrough(),
  itens: z.array(ItemNotaLido),
}).passthrough();
export type NotaAutorizadaLida = z.infer<typeof NotaAutorizadaLida>;
