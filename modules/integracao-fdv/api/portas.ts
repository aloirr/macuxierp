/**
 * Portas do recebimento e do retorno de pedidos (T-0013 P1, §5 e §6). Interfaces só: o `apps/worker` liga a implementação
 * do `pedido/api` (`criarRecebedorFdv`) e o cliente HTTP do Hub (que o conector da T-0011 implementa). Sem rede aqui.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { PedidoFdvEntrada, ResultadoRecebimentoFdv } from '@macuxierp/pedido/contracts';
import type { EntidadeChaveErp, RetornoErp } from '../contracts';
import type { PreCadastroEntrada, ResultadoPreCadastro } from '../domain';

export type { ResultadoRecebimentoFdv };

/**
 * Resolve chaves do Hub (`external_id ?? id` do registro) para o UUID do ERP, em lote (ADR 0010, item 2; RD-0317).
 * Implementação do `cadastros/api`, ligada pelo `apps/worker`: procura por `(tenant_id, external_id)` e, só se não achar e a
 * chave tiver o formato do UUID canônico, por `(tenant_id, id)` de registro com `external_id` nulo. Nunca adivinha por
 * código, documento ou nome, e não exige espelho confirmado. Chave sem registro fica fora do mapa. Não filtra inativo: o cliente inativo resolve e vira `cliente_inativo` na conferência do pedido. O endereço de entrega é `cliente_endereco`, nunca `endereco`. Roda na transação do chamador.
 * Entidades pelo nome do Hub (`EntidadeChaveErp`): a condição de pagamento é `prazo_pagamento`.
 */
export interface ResolvedorChaveErp {
  resolver(tx: Transacao, entidade: EntidadeChaveErp, chaves: readonly string[]): Promise<Map<string, string>>;
}

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
  /** Código de erro do Hub (403 `modulo_inativo`...). */
  codigo?: string;
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

// ---- Pré-cadastro de cliente do FDV (T-0059, RN-INT-22) ----
// tipos espelham o contrato do cadastros até o PR dele entrar; a entrada e a decisão ficam no domain
export type { PreCadastroEntrada, ResultadoPreCadastro };

/** Implementação no `cadastros/api`, ligada pelo `apps/worker`: a regra do pré-cadastro é do cadastros. Roda na transação do chamador. */
export interface ValidacaoPreCadastro {
  /** Valida e, se aceito, cria/atualiza o cliente e devolve o `external_id`; recusado devolve erros por campo. */
  registrar(tx: Transacao, entrada: PreCadastroEntrada): Promise<ResultadoPreCadastro>;
}
