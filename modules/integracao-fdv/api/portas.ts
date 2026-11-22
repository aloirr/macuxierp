/**
 * Portas do recebimento e do retorno de pedidos (T-0013 P1, §5 e §6). Interfaces só: o `apps/worker` liga a implementação
 * do `pedido/api` (`criarRecebedorFdv`) e o cliente HTTP do Hub (que o conector da T-0011 implementa). Sem rede aqui.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { PedidoFdvEntrada } from '../domain/pedido-fdv';
import type { RetornoErp } from '../contracts';

/**
 * Tipos mínimos locais do resultado da porta.
 * Trocar pelo contrato do pedido no merge da T-0015 (RD-0241): `ResultadoRecebimentoFdv` de `@macuxierp/pedido/contracts`.
 */
export type CodigoRecusaFdv =
  | 'modulo_pedido_inativo'
  | 'cliente_inexistente'
  | 'cliente_inativo'
  | 'produto_inexistente'
  | 'produto_inativo'
  | 'filial_inexistente'
  | 'filial_nao_emissora'
  | 'item_incoerente';

export type ResultadoRecebimentoFdv =
  | { resultado: 'criado' | 'repetido'; pedido_id: string; numero: number; status: string }
  | { resultado: 'recusado'; codigo: CodigoRecusaFdv };

/** Implementação no `pedido/api` (T-0015): roda na transação do chamador, com o ator `sistema`. */
export interface RecebedorPedidoFdv {
  receber(tx: Transacao, entrada: PedidoFdvEntrada): Promise<ResultadoRecebimentoFdv>;
}

/** Resposta do Hub já reduzida ao que importa. `status` 0 = rede (sem resposta). */
export interface RespostaPendentes {
  status: number;
  /** Itens crus: quem valida é o `PedidoParaErpLido`. */
  pedidos?: readonly unknown[];
  retryAfterS?: number;
}
export interface RespostaRetorno {
  status: number;
  retryAfterS?: number;
  /** Código de erro do Hub (422: `transicao_invalida`...). */
  codigo?: string;
  repetido?: boolean;
  itens_descartados?: readonly unknown[];
}

/** Cliente mínimo do Hub `/integracao/v1` para pedidos (o conector da T-0011 pode implementar). */
export interface ClienteHubPedidos {
  pendentes(limite: number): Promise<RespostaPendentes>;
  enviarRetorno(pedidoUuid: string, corpo: RetornoErp): Promise<RespostaRetorno>;
}

/** Log estruturado (pino): só ids e códigos, nunca documento, nome, observação ou motivo livre. */
export interface LogPedidos {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Alerta do monitor (T-0013 §5.1 e §6.3): só código e identificadores. Sem tabela própria na v1: o worker liga ao monitor. */
export type Alertar = (tenantId: string, codigo: string, contexto?: Record<string, string>) => void;
