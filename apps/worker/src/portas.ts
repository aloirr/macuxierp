/**
 * Portas do worker sobre `plataforma.evento`, `plataforma.evento_consumido` e `plataforma.trabalho` (D10: fila no
 * próprio PostgreSQL, `FOR UPDATE SKIP LOCKED`). O adaptador PostgreSQL entra depois do schema `plataforma` (T-0003);
 * os testes usam as versões em memória (`memoria.ts`).
 *
 * A reserva roda em `banco.semTenant` com o papel `macuxierp_worker` (enxerga todos os tenants nessas três tabelas)
 * e mantém as linhas travadas até o fim da transação do lote; o efeito de cada consumidor ou executor roda em
 * `banco.comTenant(tenant do evento/trabalho)`, numa transação própria.
 */
import type { EnvelopeEvento, Trabalho, Transacao } from '@macuxierp/platform-sdk';

export interface EventoPendente extends EnvelopeEvento {
  tentativas: number;
}

export interface FilaOutbox {
  /**
   * Até `limite` eventos não publicados com `proximo_em <= agora`, em ordem de `ocorrido_em`, travados
   * (`FOR UPDATE SKIP LOCKED`). Contrato da ordem por agregado: não devolve evento cujo agregado tenha outro evento
   * anterior ainda não publicado.
   */
  reservar(tx: Transacao, limite: number, agora: Date): Promise<EventoPendente[]>;
  marcarPublicado(tx: Transacao, id: string, agora: Date): Promise<void>;
  marcarFalha(tx: Transacao, id: string, tentativas: number, proximoEm: Date, erro: string): Promise<void>;
}

/** `plataforma.evento_consumido`: no máximo uma aplicação por `(consumidor, evento)`. Roda na transação do tenant. */
export interface RegistroConsumo {
  jaConsumido(tx: Transacao, consumidor: string, eventoId: string): Promise<boolean>;
  registrar(tx: Transacao, consumidor: string, eventoId: string, agora: Date): Promise<void>;
}

export interface FilaTrabalho {
  /** Até `limite` trabalhos `pendente` dos `tipos`, com `proximo_em <= agora`, travados (`FOR UPDATE SKIP LOCKED`). */
  reservar(tx: Transacao, tipos: readonly string[], limite: number, agora: Date): Promise<Trabalho[]>;
  concluir(tx: Transacao, id: string, resultado: Record<string, unknown> | null, agora: Date): Promise<void>;
  /** `proximoEm` nulo = desistiu (estado `falhou`). */
  falhar(tx: Transacao, id: string, tentativas: number, proximoEm: Date | null, erro: string): Promise<void>;
}
