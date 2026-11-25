/**
 * Zerar pedidos não faturados por cadastro (RN-CAD-10, T-0093): entrada e resposta do plugin de plataforma do portal
 * `/config` (só superadmin). A resposta leva só contagens, sem dado do pedido (LGPD, regra 8).
 */
import { FRASE_ZERAR_DADOS, MENSAGEM_FRASE_ZERAR, fraseConfere } from '@macuxierp/platform-sdk';
import { z } from 'zod';

/** Prévia só lê; o zerar exige `Idempotency-Key`. */
export const CAMINHOS_ZERAR_PEDIDOS = Object.freeze({
  previa: '/empresas/:id/pedidos/zerar/previa',
  zerar: '/empresas/:id/pedidos/zerar',
});

/** Mesma frase do Zerar por cadastro (`FRASE_ZERAR_DADOS`, sem diferenciar maiúsculas e ponto final). */
export const ZerarPedidosEntrada = z
  .object({ frase: z.string().max(200) })
  .refine((r) => fraseConfere(r.frase, FRASE_ZERAR_DADOS), { path: ['frase'], message: MENSAGEM_FRASE_ZERAR });
export type ZerarPedidosEntrada = z.infer<typeof ZerarPedidosEntrada>;

const Contagem = z.number().int().min(0);
export const TABELAS_ZERAR_PEDIDOS = [
  'pedido',
  'pedido_item',
  'pedido_evento',
  'aprovacao',
  // Efeitos da porta `aposZerarPedidos` (T-0093, critério 3): contagens devolvidas pelas funções dos outros donos.
  'integracao_fdv.pedido_recebido',
  'integracao_fdv.retorno_enviado',
  'faturamento.pedido_a_faturar',
] as const;
/** Motivos de manter: nota e título (RN-CAD-10). */
export const MOTIVOS_MANTER_PEDIDO = ['nota', 'titulo'] as const;

export const ApagadoZerarPedidos = z.object({ tabela: z.enum(TABELAS_ZERAR_PEDIDOS), quantidade: Contagem });

export const ZeragemPedidosResposta = z.object({
  empresa_id: z.string().uuid(),
  simulado: z.boolean(),
  apagados: z.array(ApagadoZerarPedidos),
  /** Dos pedidos apagados, os do FDV: só voltam pelo reenvio do FDV (RN-PED-01). */
  apagados_fdv: Contagem,
  mantidos: z.array(z.object({ motivo: z.enum(MOTIVOS_MANTER_PEDIDO), quantidade: Contagem })),
});
export type ZeragemPedidosResposta = z.infer<typeof ZeragemPedidosResposta>;
