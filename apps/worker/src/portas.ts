/**
 * Portas do worker sobre `plataforma.evento`, `plataforma.evento_consumido` e `plataforma.trabalho` (D10: fila no
 * próprio PostgreSQL, `SKIP LOCKED`). Adaptador PostgreSQL: `pg.ts`; testes de unidade: `memoria.ts`.
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
   * (`SKIP LOCKED`). Contrato da ordem por agregado: não devolve evento cujo agregado tenha outro evento
   * anterior ainda não publicado.
   */
  reservar(tx: Transacao, limite: number, agora: Date): Promise<EventoPendente[]>;
  marcarPublicado(tx: Transacao, id: string, agora: Date): Promise<void>;
  marcarFalha(tx: Transacao, id: string, tentativas: number, proximoEm: Date, erro: string): Promise<void>;
  /**
   * Estado terminal `falhou` (limite de tentativas, T-0045) sem coluna nova: `publicado_em = agora` (sai da fila e libera
   * o agregado), `tentativas` e `erro` (começa por `falhou: `). Quem não aplicou fica sem linha em `evento_consumido`.
   */
  marcarFalhou(tx: Transacao, id: string, tentativas: number, agora: Date, erro: string): Promise<void>;
}

/**
 * Releitura dos eventos já publicados para a reentrega da partida (`reentrega.ts`). Só `plataforma.evento` e
 * `plataforma.evento_consumido` (regra 1: nada de schema de módulo), em `banco.semTenant` no papel do worker.
 */
export interface FonteReentrega {
  /**
   * Até `limite` eventos `nome` com `publicado_em` preenchido e sem falha terminal (`erro` nulo), sem linha em
   * `evento_consumido` para `consumidor` e fora de `ignorar` (ids que já falharam nesta rodada), em ordem de
   * `ocorrido_em`, `versao` e `id`.
   */
  pendentes(tx: Transacao, consumidor: string, nome: string, ignorar: readonly string[], limite: number): Promise<EnvelopeEvento[]>;
}

/** Alerta do monitor (mesma forma do `Alertar` do integracao-fdv): só código e ids no contexto, nunca dado pessoal. */
export type AlertarWorker = (tenantId: string, codigo: string, contexto?: Record<string, string>) => void;

/** `plataforma.evento_consumido`: no máximo uma aplicação por `(consumidor, evento)`. Roda na transação do tenant. */
export interface RegistroConsumo {
  jaConsumido(tx: Transacao, consumidor: string, eventoId: string): Promise<boolean>;
  registrar(tx: Transacao, consumidor: string, eventoId: string, agora: Date): Promise<void>;
}

export interface ReservaTrabalhos {
  /** Até `limite` trabalhos `pendente` dos `tipos`, com `proximo_em <= agora`, travados (`SKIP LOCKED`). */
  reservar(tx: Transacao, tipos: readonly string[], limite: number, agora: Date): Promise<Trabalho[]>;
  concluir(tx: Transacao, id: string, resultado: Record<string, unknown> | null, agora: Date): Promise<void>;
  /** `proximoEm` nulo = desistiu (estado `falhou`). */
  falhar(tx: Transacao, id: string, tentativas: number, proximoEm: Date | null, erro: string): Promise<void>;
}
