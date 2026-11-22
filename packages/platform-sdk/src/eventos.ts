/**
 * Eventos entre módulos pela outbox (`plataforma.evento`), gravados na mesma transação da escrita.
 * Envelope: `.coord/contratos/eventos.md` (fonte da verdade). Despacho: apps/worker (ordem de `ocorrido_em` por agregado).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Transacao } from './banco';
import { PADRAO_EVENTO } from './modulo';

export const EnvelopeEvento = z.object({
  id: z.string().uuid(),
  nome: z.string().regex(PADRAO_EVENTO, 'nome fora do padrão <modulo>.<entidade>.<fato>@vN'),
  tenant_id: z.string().uuid(),
  agregado_id: z.string().uuid(),
  versao: z.number().int().min(1),
  ocorrido_em: z.string().datetime(),
  ator: z.union([z.string().uuid(), z.literal('sistema')]),
  request_id: z.string().min(1),
  payload: z.record(z.unknown()),
});
export type EnvelopeEvento = z.infer<typeof EnvelopeEvento>;

export type DadosEvento = Omit<EnvelopeEvento, 'id' | 'ocorrido_em'>;

/** Monta e valida o envelope (id e instante gerados aqui, em UTC). */
export function criarEvento(dados: DadosEvento, agora: Date, id: string = randomUUID()): EnvelopeEvento {
  return EnvelopeEvento.parse({ ...dados, id, ocorrido_em: agora.toISOString() });
}

/** Porta da outbox: grava o evento na transação corrente. */
export interface Outbox {
  gravar(tx: Transacao, evento: EnvelopeEvento): Promise<void>;
}

/**
 * Consumidor de eventos (handler de módulo). `id` é o nome estável do consumidor em `plataforma.evento_consumido`
 * (ex.: `integracao-fdv.publicar-cadastros`): o worker garante no máximo uma aplicação por `(id, evento.id)`.
 * Descartar `versao` menor que a última aplicada ao agregado é do consumidor (contrato de eventos).
 */
export interface ConsumidorEvento {
  id: string;
  eventos: readonly string[];
  tratar(evento: EnvelopeEvento, tx: Transacao): Promise<void>;
}
