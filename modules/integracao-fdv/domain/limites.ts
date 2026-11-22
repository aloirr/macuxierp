/**
 * Limites próprios do conector por tenant (T-0009 seção 6): 75 % e 40 % do balde do Hub. Decisão pura sobre as
 * marcas de tempo já feitas; quem guarda as marcas (worker) é a L2.
 */
export const LOTES_POR_MINUTO = 15;
export const CHAMADAS_POR_MINUTO = 120;
export const LOTES_EM_VOO_POR_ENTIDADE = 1;
const JANELA_MS = 60_000;

export type DecisaoEnvio = { permitido: true } | { permitido: false; motivo: 'lote_em_voo' | 'limite_lotes' | 'limite_chamadas'; esperarSegundos: number };

function naJanela(marcas: readonly number[], agora: number): number[] {
  return marcas.filter((t) => t > agora - JANELA_MS && t <= agora).sort((a, b) => a - b);
}

function espera(marcas: number[], limite: number, agora: number): number {
  const mais_antiga = marcas[marcas.length - limite]!;
  return Math.max(1, Math.ceil((mais_antiga + JANELA_MS - agora) / 1000));
}

export interface EntradaLimite {
  agora: number;
  /** Instantes (ms) dos `POST /lotes` do tenant. */
  lotesEm: readonly number[];
  /** Instantes (ms) de todas as chamadas ao Hub do tenant. */
  chamadasEm: readonly number[];
  /** Lotes da entidade em estado montado/enviando/aceito. */
  emVooNaEntidade: number;
}

/** Pode enviar um lote agora? Conta também a chamada do próprio lote (1 chamada por lote). */
export function decidirEnvioLote(e: EntradaLimite): DecisaoEnvio {
  if (e.emVooNaEntidade >= LOTES_EM_VOO_POR_ENTIDADE) return { permitido: false, motivo: 'lote_em_voo', esperarSegundos: 5 };
  const lotes = naJanela(e.lotesEm, e.agora);
  if (lotes.length >= LOTES_POR_MINUTO) return { permitido: false, motivo: 'limite_lotes', esperarSegundos: espera(lotes, LOTES_POR_MINUTO, e.agora) };
  return decidirChamada(e);
}

export function decidirChamada(e: Pick<EntradaLimite, 'agora' | 'chamadasEm'>): DecisaoEnvio {
  const chamadas = naJanela(e.chamadasEm, e.agora);
  if (chamadas.length >= CHAMADAS_POR_MINUTO) return { permitido: false, motivo: 'limite_chamadas', esperarSegundos: espera(chamadas, CHAMADAS_POR_MINUTO, e.agora) };
  return { permitido: true };
}

/**
 * Cotas de uma reserva da agenda (T-0009 6.1): o sinal (uma linha por tenant, vence a cada minuto) e a reconciliação
 * (diária) nunca ocupam o limite todo e o envio nunca fica sem vez. O que o sinal e a reconciliação não usarem sobra para
 * o envio. Reserva-se nesta ordem: sinal, reconciliação, envio.
 */
export function repartirLimiteAgenda(limite: number): { sinal: number; reconciliacao: number; envio: number } {
  const l = Math.max(0, Math.floor(limite));
  const sinal = Math.min(Math.ceil(l / 3), Math.max(0, l - 1));
  const reconciliacao = Math.min(Math.ceil(l / 6), Math.max(0, l - sinal - 1));
  return { sinal, reconciliacao, envio: l - sinal - reconciliacao };
}
