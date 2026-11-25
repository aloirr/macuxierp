/**
 * T-0096: latitude (−90 a 90) e longitude (−180 a 180) do endereço. Função pura; nunca recusa nem registra o valor (LGPD).
 * Os dois andam juntos: se um for ausente, não numérico ou fora da faixa, os dois ficam nulos.
 */
const LATITUDE_MIN = -90;
const LATITUDE_MAX = 90;
const LONGITUDE_MIN = -180;
const LONGITUDE_MAX = 180;

export interface Coordenada {
  latitude: number | null;
  longitude: number | null;
}

const naFaixa = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function normalizarCoordenada(latitude: unknown, longitude: unknown): Coordenada {
  if (naFaixa(latitude, LATITUDE_MIN, LATITUDE_MAX) && naFaixa(longitude, LONGITUDE_MIN, LONGITUDE_MAX)) return { latitude, longitude };
  return { latitude: null, longitude: null };
}

/** Aplica `normalizarCoordenada` a um endereço (corpo de rota): devolve cópia com os dois campos sempre presentes. */
export function comCoordenadaNormalizada<T extends Record<string, unknown>>(endereco: T): T & Coordenada {
  return { ...endereco, ...normalizarCoordenada(endereco.latitude, endereco.longitude) };
}
