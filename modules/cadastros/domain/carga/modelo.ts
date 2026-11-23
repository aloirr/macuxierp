import { paraCsv } from '@macuxierp/platform-sdk';
import type { EntidadeCarga } from '../../contracts';
import { LAYOUT } from './layout';

/** RF-CAD-11: colunas do modelo, primeiro as obrigatórias e depois as demais usadas (as ignoradas ficam de fora). */
export function colunasDoModelo(entidade: EntidadeCarga): string[] {
  const l = LAYOUT[entidade];
  return [...l.obrigatorias, ...l.usadas.filter((c) => !l.obrigatorias.includes(c))];
}

/** RF-CAD-11: modelo CSV da entidade, só o cabeçalho; UTF-8 com BOM e `;` (as constantes são as do `paraCsv` do SDK). */
export function modeloCsv(entidade: EntidadeCarga): string {
  return paraCsv(colunasDoModelo(entidade).map((titulo) => ({ titulo, valor: () => '' })), []);
}
