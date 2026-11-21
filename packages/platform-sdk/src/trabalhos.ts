/**
 * Fila de trabalhos no próprio PostgreSQL (`plataforma.trabalho`, D10): consulta de IE (D5), exportação LGPD
 * (RF-CORE-06) e, depois, SEFAZ e Hub. A rota enfileira na mesma transação da escrita e responde 202; o worker executa.
 * O executor é idempotente: o mesmo trabalho pode rodar de novo se o worker cair entre executar e registrar.
 */
import type { Transacao } from './banco';

export const PADRAO_TIPO_TRABALHO = /^(core|cadastros|pedido|faturamento|fiscal|integracao-fdv)\.[a-z_]+$/;

export interface PedidoTrabalho {
  /** `<modulo>.<tarefa>` (ex.: `cadastros.consultar_ie`). */
  tipo: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  /** Idempotência do enfileiramento (RN-CORE-05): mesmo `external_id` no mesmo tenant e tipo não duplica. */
  external_id?: string;
}

export interface Trabalho extends PedidoTrabalho {
  id: string;
  tentativas: number;
}

/** Porta do lado de quem enfileira (API). */
export interface FilaDeTrabalhos {
  enfileirar(tx: Transacao, pedido: PedidoTrabalho): Promise<{ id: string }>;
}

/** Executor de um tipo de trabalho (worker). Roda na transação do tenant do trabalho. */
export interface ExecutorTrabalho {
  tipo: string;
  /** Depois disso o trabalho fica `falhou` (padrão 5). */
  maxTentativas?: number;
  executar(trabalho: Trabalho, tx: Transacao): Promise<Record<string, unknown> | null>;
}
