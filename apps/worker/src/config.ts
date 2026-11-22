/**
 * Leitura das variáveis numéricas do worker (main.ts). Só nomes e faixas na mensagem de erro, nunca o valor (regra 9).
 */

/** Mínimo do pool do worker: o trabalho da SEFAZ usa até 3 conexões ao mesmo tempo (reserva `semTenant`, tx do executor e a memória do simulador, T-0045 §9). */
const POOL_MINIMO_WORKER = 4;
const POOL_MAXIMO_WORKER = 50;
const POOL_PADRAO_WORKER = 5;

type Ambiente = Readonly<Record<string, string | undefined>>;

/** Inteiro de `min` a `max`; ausente ou vazio vira `padrao`. Fora da faixa derruba a partida com o nome da variável. */
export function inteiroDoAmbiente(env: Ambiente, nome: string, padrao: number, min: number, max: number, motivo?: string): number {
  const bruto = env[nome];
  const n = bruto === undefined || bruto.trim() === '' ? padrao : Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`configuração inválida: ${nome} (inteiro de ${min} a ${max}${motivo ? `; ${motivo}` : ''})`);
  return n;
}

/** `MACUXIERP_PG_POOL` do worker (padrão 5, de 4 a 50). Abaixo de 4 o trabalho da SEFAZ esperaria conexão para sempre. */
export function poolDoWorker(env: Ambiente): number {
  return inteiroDoAmbiente(env, 'MACUXIERP_PG_POOL', POOL_PADRAO_WORKER, POOL_MINIMO_WORKER, POOL_MAXIMO_WORKER, 'o trabalho da SEFAZ usa até 3 conexões ao mesmo tempo');
}
