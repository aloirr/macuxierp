/**
 * Data e hora no formato da NF-e (`AAAA-MM-DDThh:mm:ssTZD`, ex.: `2026-11-21T22:59:00-04:00`).
 * O banco guarda UTC; o XML leva o deslocamento da filial. O AM não tem horário de verão: -04:00 (−240 min).
 */

export const DESLOCAMENTO_MANAUS_MIN = -240;

const RE_DATA_HORA_SEFAZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;

export function ehDataHoraSefaz(texto: string): boolean {
  return RE_DATA_HORA_SEFAZ.test(texto) && !Number.isNaN(Date.parse(texto));
}

/** Formata um instante (UTC) no formato da NF-e com o deslocamento dado (padrão: Manaus). */
export function dataHoraSefaz(instante: Date, deslocamentoMin: number = DESLOCAMENTO_MANAUS_MIN): string {
  if (!Number.isInteger(deslocamentoMin) || Math.abs(deslocamentoMin) > 14 * 60) {
    throw new RangeError('dataHoraSefaz: deslocamento fora de −14h..+14h');
  }
  const local = new Date(instante.getTime() + deslocamentoMin * 60_000).toISOString().slice(0, 19);
  const sinal = deslocamentoMin < 0 ? '-' : '+';
  const abs = Math.abs(deslocamentoMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sinal}${hh}:${mm}`;
}

/** AAMM (ano e mês da emissão) de uma data já no formato da NF-e: o campo da chave de acesso. */
export function aammSefaz(dhSefaz: string): string {
  return dhSefaz.slice(2, 4) + dhSefaz.slice(5, 7);
}
