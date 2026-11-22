/**
 * Idempotency-Key do envio (RN-CORE-05): uma chave por tentativa; reenvio do MESMO corpo reusa a chave (clique duplo, queda de rede);
 * corpo diferente depois de resposta 4xx definitiva ganha chave nova, senão a API devolveria a resposta guardada do corpo antigo.
 */
export interface EstadoChave {
  chave: string;
  /** Corpo (JSON) da última tentativa; null antes do primeiro envio. */
  corpo: string | null;
  /** A última resposta foi um 4xx definitivo (a API guardou a resposta para esta chave). */
  definitivo: boolean;
}

export const novoEstado = (gerar: () => string): EstadoChave => ({ chave: gerar(), corpo: null, definitivo: false });

/** Chave a usar neste envio: renova só quando o corpo mudou depois de um 4xx definitivo. */
export function chaveParaEnvio(e: EstadoChave, corpo: unknown, gerar: () => string): EstadoChave {
  const json = JSON.stringify(corpo) ?? '';
  if (e.definitivo && e.corpo !== json) return { chave: gerar(), corpo: json, definitivo: false };
  return { ...e, corpo: json };
}

/**
 * Estado de partida de um clique em ação cujo corpo carrega a própria chave (ex.: emitir nota): depois de 4xx definitivo a chave é nova,
 * senão o corpo nunca muda e a API devolveria a resposta guardada. O corpo e o cabeçalho usam sempre a chave devolvida aqui.
 */
export const estadoDoClique = (e: EstadoChave | undefined, gerar: () => string): EstadoChave => (e && !e.definitivo ? e : novoEstado(gerar));

/** Registra se a resposta foi definitiva (4xx, exceto 408 e 429, que se repetem). */
export const aposResposta = (e: EstadoChave, definitivo: boolean): EstadoChave => ({ ...e, definitivo });

export const ehRespostaDefinitiva = (status: number): boolean => status >= 400 && status < 500 && status !== 408 && status !== 429;
